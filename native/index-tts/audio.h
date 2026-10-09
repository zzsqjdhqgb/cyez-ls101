#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace index_tts {
constexpr size_t max_reference_bytes = 32 * 1024 * 1024;
constexpr size_t max_output_bytes = 100 * 1024 * 1024;

inline uint16_t u16(const uint8_t *p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
inline uint32_t u32(const uint8_t *p) {
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}
inline void put16(std::vector<uint8_t> &out, size_t offset, uint16_t value) {
    out[offset] = static_cast<uint8_t>(value); out[offset + 1] = static_cast<uint8_t>(value >> 8);
}
inline void put32(std::vector<uint8_t> &out, size_t offset, uint32_t value) {
    for (size_t i = 0; i < 4; ++i) out[offset + i] = static_cast<uint8_t>(value >> (i * 8));
}

struct Audio {
    std::vector<float> samples;
    int rate = 0;
    int channels = 0;
};

inline Audio decode_wav(const std::vector<uint8_t> &bytes) {
    const auto fail = [] { throw std::runtime_error("Reference WAV is invalid or exceeds supported limits"); };
    if (bytes.size() < 44 || bytes.size() > max_reference_bytes ||
        std::memcmp(bytes.data(), "RIFF", 4) || std::memcmp(bytes.data() + 8, "WAVE", 4) ||
        u32(bytes.data() + 4) != bytes.size() - 8) fail();
    Audio out;
    int format = 0, bits = 0, alignment = 0;
    const uint8_t *pcm = nullptr;
    size_t pcm_size = 0;
    bool have_format = false;
    size_t offset = 12;
    while (offset < bytes.size()) {
        if (bytes.size() - offset < 8) fail();
        const auto *chunk = bytes.data() + offset;
        const size_t size = u32(chunk + 4);
        offset += 8;
        if (size > bytes.size() - offset) fail();
        if (!std::memcmp(chunk, "fmt ", 4)) {
            if (have_format || size < 16) fail();
            have_format = true;
            format = u16(bytes.data() + offset);
            out.channels = u16(bytes.data() + offset + 2);
            const uint32_t rate = u32(bytes.data() + offset + 4);
            if (rate < 8000 || rate > 192000) fail();
            out.rate = static_cast<int>(rate);
            alignment = u16(bytes.data() + offset + 12);
            bits = u16(bytes.data() + offset + 14);
            if (out.channels < 1 || out.channels > 2 ||
                !((format == 1 && (bits == 16 || bits == 24 || bits == 32)) || (format == 3 && bits == 32)) ||
                alignment != out.channels * (bits / 8) ||
                u32(bytes.data() + offset + 8) != static_cast<uint32_t>(out.rate * alignment)) fail();
        } else if (!std::memcmp(chunk, "data", 4)) {
            if (pcm) fail();
            pcm = bytes.data() + offset;
            pcm_size = size;
        }
        offset += size;
        if (size % 2) {
            if (offset == bytes.size()) fail();
            ++offset;
        }
    }
    if (!have_format || !pcm || !pcm_size || pcm_size % static_cast<size_t>(alignment)) fail();
    const size_t frames = pcm_size / static_cast<size_t>(alignment);
    if (frames > static_cast<size_t>(out.rate) * 30) fail();
    out.samples.resize(frames * static_cast<size_t>(out.channels));
    for (size_t i = 0; i < out.samples.size(); ++i) {
        const auto *p = pcm + i * static_cast<size_t>(bits / 8);
        float value = 0;
        if (format == 3) {
            const uint32_t raw = u32(p);
            std::memcpy(&value, &raw, 4);
        } else if (bits == 16) {
            const int32_t raw = u16(p);
            value = static_cast<float>(raw >= 0x8000 ? raw - 0x10000 : raw) / 32768.0f;
        } else if (bits == 24) {
            const int32_t raw = static_cast<int32_t>(p[0] | (p[1] << 8) | (p[2] << 16));
            value = static_cast<float>(raw >= 0x800000 ? raw - 0x1000000 : raw) / 8388608.0f;
        } else {
            const uint32_t raw = u32(p);
            const int64_t signed_raw = raw >= 0x80000000u ? static_cast<int64_t>(raw) - 0x100000000LL : raw;
            value = static_cast<float>(signed_raw / 2147483648.0);
        }
        if (!std::isfinite(value) || value < -1.0f || value > 1.0f) fail();
        out.samples[i] = value;
    }
    return out;
}

inline Audio read_reference(const std::string &filename) {
    const auto path = std::filesystem::u8path(filename);
    if (!path.is_absolute()) throw std::runtime_error("Reference WAV path must be absolute");
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) throw std::runtime_error("Cannot open reference WAV");
    const auto size = input.tellg();
    if (size < 44 || size > static_cast<std::streamoff>(max_reference_bytes)) {
        throw std::runtime_error("Reference WAV size exceeds limits");
    }
    std::vector<uint8_t> bytes(static_cast<size_t>(size));
    input.seekg(0);
    if (!input.read(reinterpret_cast<char *>(bytes.data()), size)) throw std::runtime_error("Reference WAV is truncated");
    return decode_wav(bytes);
}

inline std::vector<uint8_t> encode_wav(const float *samples, size_t frames, int rate, int channels) {
    if (!samples || !frames || rate < 8000 || rate > 192000 || channels != 1 || frames > (max_output_bytes - 44) / 2) {
        throw std::runtime_error("Inference returned invalid or oversized audio");
    }
    std::vector<uint8_t> out(44 + frames * 2);
    std::memcpy(out.data(), "RIFF", 4); put32(out, 4, static_cast<uint32_t>(out.size() - 8));
    std::memcpy(out.data() + 8, "WAVEfmt ", 8); put32(out, 16, 16);
    put16(out, 20, 1); put16(out, 22, 1); put32(out, 24, static_cast<uint32_t>(rate));
    put32(out, 28, static_cast<uint32_t>(rate * 2)); put16(out, 32, 2); put16(out, 34, 16);
    std::memcpy(out.data() + 36, "data", 4); put32(out, 40, static_cast<uint32_t>(frames * 2));
    for (size_t i = 0; i < frames; ++i) {
        if (!std::isfinite(samples[i])) throw std::runtime_error("Inference returned non-finite audio");
        const auto value = static_cast<int16_t>(std::lround(std::clamp(samples[i], -1.0f, 1.0f) * 32767.0f));
        put16(out, 44 + i * 2, static_cast<uint16_t>(value));
    }
    return out;
}
} // namespace index_tts
