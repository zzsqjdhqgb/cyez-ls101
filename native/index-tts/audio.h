#pragma once

// WAV helpers for the IndexTTS helper: decoding reference audio and encoding
// the synthesized result. Kept header-only so the helper stays a single
// translation unit plus the vendored C ABI facade.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <string>
#include <vector>

namespace ls101_index_tts {

constexpr size_t kMaxReferenceWavBytes = 32 * 1024 * 1024;

struct DecodedWav {
    std::vector<float> samples; // mono, interleaving removed
    int sample_rate = 0;
};

struct WavFormat {
    uint16_t audio_format = 0;
    uint16_t channels = 0;
    uint32_t sample_rate = 0;
    uint16_t bits_per_sample = 0;
};

inline uint32_t read_u32_le(const uint8_t * data) {
    return static_cast<uint32_t>(data[0]) | (static_cast<uint32_t>(data[1]) << 8) |
        (static_cast<uint32_t>(data[2]) << 16) | (static_cast<uint32_t>(data[3]) << 24);
}

inline uint16_t read_u16_le(const uint8_t * data) {
    return static_cast<uint16_t>(static_cast<uint16_t>(data[0]) |
        (static_cast<uint16_t>(data[1]) << 8));
}

inline bool fourcc(const uint8_t * data, const char (&tag)[5]) {
    return std::memcmp(data, tag, 4) == 0;
}

// Decodes a RIFF/WAVE file. The whole chunk list is walked so an unexpected
// chunk between "fmt " and "data" is tolerated while a malformed structure is
// reported instead of trusted. Multi-channel audio is mixed down to mono and
// the result is normalized into [-1, 1].
inline bool decode_wav(const std::string & path, DecodedWav & out, std::string & error) {
    // The path arrives as UTF-8 (it originates from the JSON payload). On
    // Windows the narrow std::string constructor of std::filesystem::path
    // decodes it with the ANSI code page, which breaks reference audio under
    // non-ASCII (e.g. Chinese) user directories; u8path keeps the UTF-8
    // semantics. On POSIX the native narrow encoding already is UTF-8, so a
    // plain path is used (u8path is deprecated from C++20 on).
#if defined(_WIN32)
    const std::filesystem::path file_path = std::filesystem::u8path(path);
#else
    const std::filesystem::path file_path(path);
#endif
    std::ifstream input(file_path, std::ios::binary);
    if (!input) {
        error = "cannot open reference WAV";
        return false;
    }
    input.seekg(0, std::ios::end);
    const std::streamoff length = input.tellg();
    input.seekg(0);
    if (length < 12) {
        error = "reference WAV is truncated";
        return false;
    }
    if (length > static_cast<std::streamoff>(kMaxReferenceWavBytes)) {
        error = "reference WAV exceeds the 32 MiB size limit";
        return false;
    }
    std::vector<uint8_t> bytes(static_cast<size_t>(length));
    input.read(reinterpret_cast<char *>(bytes.data()), length);
    if (input.gcount() != length) {
        error = "cannot read reference WAV";
        return false;
    }

    if (!fourcc(bytes.data(), "RIFF") || !fourcc(bytes.data() + 8, "WAVE")) {
        error = "reference WAV is not RIFF/WAVE";
        return false;
    }
    const uint32_t declared_riff_size = read_u32_le(bytes.data() + 4);
    // 64-bit arithmetic: declared_riff_size + 8 would wrap around uint32_t for
    // a crafted size field and bypass the bound check.
    if (static_cast<uint64_t>(declared_riff_size) + 8 >
        static_cast<uint64_t>(bytes.size()) + 1) {
        error = "reference WAV RIFF size exceeds the file";
        return false;
    }

    bool have_format = false;
    bool have_data = false;
    WavFormat format{};
    size_t data_offset = 0;
    uint32_t data_size = 0;
    size_t offset = 12;
    while (offset + 8 <= bytes.size()) {
        const uint8_t * chunk_header = bytes.data() + offset;
        const uint32_t chunk_size = read_u32_le(chunk_header + 4);
        const size_t chunk_start = offset + 8;
        if (chunk_size > bytes.size() - chunk_start) {
            error = "reference WAV chunk exceeds the file";
            return false;
        }
        if (fourcc(chunk_header, "fmt ")) {
            if (chunk_size < 16) {
                error = "reference WAV format chunk is too small";
                return false;
            }
            const uint8_t * chunk = bytes.data() + chunk_start;
            format.audio_format = read_u16_le(chunk);
            format.channels = read_u16_le(chunk + 2);
            format.sample_rate = read_u32_le(chunk + 4);
            format.bits_per_sample = read_u16_le(chunk + 14);
            if (format.audio_format == 0xFFFE && chunk_size >= 40) {
                // WAVE_FORMAT_EXTENSIBLE: the real format code is the first two
                // bytes of the SubFormat GUID.
                format.audio_format = read_u16_le(chunk + 24);
            }
            have_format = true;
        } else if (fourcc(chunk_header, "data")) {
            data_offset = chunk_start;
            data_size = chunk_size;
            have_data = true;
        }
        offset = chunk_start + chunk_size + (chunk_size & 1u);
    }
    if (!have_format || !have_data) {
        error = "reference WAV is missing a fmt or data chunk";
        return false;
    }

    if (format.channels == 0 || format.channels > 32) {
        error = "reference WAV channel count is invalid";
        return false;
    }
    if (format.sample_rate < 8000 || format.sample_rate > 192000) {
        error = "reference WAV sample rate must be between 8000 and 192000 Hz";
        return false;
    }
    const bool is_float = format.audio_format == 3;
    const bool is_pcm = format.audio_format == 1;
    if (!is_pcm && !is_float) {
        error = "reference WAV must be PCM or IEEE float";
        return false;
    }
    if (is_float && format.bits_per_sample != 32) {
        error = "reference WAV float data must be 32-bit";
        return false;
    }
    if (is_pcm &&
        format.bits_per_sample != 8 && format.bits_per_sample != 16 &&
        format.bits_per_sample != 24 && format.bits_per_sample != 32) {
        error = "reference WAV bit depth is unsupported";
        return false;
    }
    const size_t bytes_per_sample = format.bits_per_sample / 8;
    const size_t block_align = bytes_per_sample * format.channels;
    if (block_align == 0 || data_size < block_align || data_size % block_align != 0) {
        error = "reference WAV data chunk is not frame aligned";
        return false;
    }

    const size_t frames = data_size / block_align;
    if (frames == 0) {
        error = "reference WAV contains no audio frames";
        return false;
    }
    out.samples.resize(frames);
    out.sample_rate = static_cast<int>(format.sample_rate);
    const uint8_t * data = bytes.data() + data_offset;
    for (size_t frame = 0; frame < frames; ++frame) {
        double mixed = 0.0;
        for (size_t channel = 0; channel < format.channels; ++channel) {
            const uint8_t * sample = data + frame * block_align + channel * bytes_per_sample;
            double value = 0.0;
            if (is_float) {
                uint32_t raw = 0;
                for (size_t byte = 0; byte < 4; ++byte) {
                    raw |= static_cast<uint32_t>(sample[byte]) << (8 * byte);
                }
                float stored = 0.0f;
                std::memcpy(&stored, &raw, sizeof(stored));
                value = stored;
            } else if (format.bits_per_sample == 8) {
                value = (static_cast<int>(sample[0]) - 128) / 128.0;
            } else if (format.bits_per_sample == 16) {
                const int16_t stored = static_cast<int16_t>(read_u16_le(sample));
                value = stored / 32768.0;
            } else if (format.bits_per_sample == 24) {
                // Assemble the 24-bit little-endian value with unsigned shifts
                // only, then sign-extend arithmetically: left-shifting the
                // sign-extended int8_t high byte (a negative value) would be
                // undefined behaviour before C++20.
                const uint32_t magnitude = static_cast<uint32_t>(sample[0]) |
                    (static_cast<uint32_t>(sample[1]) << 8) |
                    (static_cast<uint32_t>(sample[2]) << 16);
                int32_t stored = static_cast<int32_t>(magnitude);
                if (magnitude >= 0x800000u) stored -= 0x1000000;
                value = stored / 8388608.0;
            } else {
                uint32_t raw = 0;
                for (size_t byte = 0; byte < 4; ++byte) {
                    raw |= static_cast<uint32_t>(sample[byte]) << (8 * byte);
                }
                value = static_cast<int32_t>(raw) / 2147483648.0;
            }
            if (!std::isfinite(value)) value = 0.0;
            mixed += value;
        }
        mixed /= static_cast<double>(format.channels);
        out.samples[frame] = static_cast<float>(mixed);
    }
    return true;
}

inline void append_u16(std::vector<uint8_t> & output, uint16_t value) {
    output.push_back(static_cast<uint8_t>(value & 0xff));
    output.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
}

inline void append_u32(std::vector<uint8_t> & output, uint32_t value) {
    output.push_back(static_cast<uint8_t>(value & 0xff));
    output.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
    output.push_back(static_cast<uint8_t>((value >> 16) & 0xff));
    output.push_back(static_cast<uint8_t>((value >> 24) & 0xff));
}

// Encodes mono float samples as a canonical 44-byte-header PCM16 WAV. The
// header is self-consistent: byteRate = rate * 2, blockAlign = 2, and the RIFF
// and data sizes match the payload exactly.
inline std::vector<uint8_t> encode_wav_pcm16(const std::vector<float> & samples, int sample_rate) {
    const uint64_t data_bytes = static_cast<uint64_t>(samples.size()) * 2;
    if (data_bytes > std::numeric_limits<uint32_t>::max() - 36) {
        return {};
    }
    const uint32_t data_size = static_cast<uint32_t>(data_bytes);
    std::vector<uint8_t> output;
    output.reserve(44 + samples.size() * 2);
    const auto append_text = [&output](const char (&tag)[5]) {
        output.insert(output.end(), tag, tag + 4);
    };
    append_text("RIFF");
    append_u32(output, 36 + data_size);
    append_text("WAVE");
    append_text("fmt ");
    append_u32(output, 16);
    append_u16(output, 1); // PCM
    append_u16(output, 1); // mono
    append_u32(output, static_cast<uint32_t>(sample_rate));
    append_u32(output, static_cast<uint32_t>(sample_rate) * 2);
    append_u16(output, 2);
    append_u16(output, 16);
    append_text("data");
    append_u32(output, data_size);
    for (float sample : samples) {
        const float finite = std::isfinite(sample) ? sample : 0.0f;
        const float clamped = std::max(-1.0f, std::min(1.0f, finite));
        const int16_t pcm = static_cast<int16_t>(std::lrint(clamped * 32767.0f));
        append_u16(output, static_cast<uint16_t>(pcm));
    }
    return output;
}

} // namespace ls101_index_tts
