#include "qwen3_tts.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

constexpr uint32_t kEmbeddingSize = 1024;
constexpr size_t kMaxTextBytes = 64 * 1024;
constexpr size_t kMaxAudioBytes = 100 * 1024 * 1024;

struct Options {
    std::string model_dir;
    std::string speaker_file;
    std::string extract_input;
    std::string extract_output;
    int threads = 4;
    int max_audio_tokens = 2048;
    int top_k = 50;
    float temperature = 0.9f;
    float repetition_penalty = 1.05f;
};

bool parse_int(const char * value, int min, int max, int & output) {
    if (!value || !*value) return false;
    char * end = nullptr;
    const long parsed = std::strtol(value, &end, 10);
    if (*end != '\0' || parsed < min || parsed > max) return false;
    output = static_cast<int>(parsed);
    return true;
}

bool parse_float(const char * value, float min, float max, float & output) {
    if (!value || !*value) return false;
    char * end = nullptr;
    const float parsed = std::strtof(value, &end);
    if (*end != '\0' || !std::isfinite(parsed) || parsed < min || parsed > max) return false;
    output = parsed;
    return true;
}

bool next_value(int argc, char ** argv, int & index, std::string & output) {
    if (++index >= argc) return false;
    output = argv[index];
    return true;
}

bool parse_options(int argc, char ** argv, Options & options) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        std::string value;
        if (arg == "--model-dir") {
            if (!next_value(argc, argv, i, options.model_dir)) return false;
        } else if (arg == "--speaker") {
            if (!next_value(argc, argv, i, options.speaker_file)) return false;
        } else if (arg == "--extract-speaker") {
            if (!next_value(argc, argv, i, options.extract_input)) return false;
            if (!next_value(argc, argv, i, options.extract_output)) return false;
        } else if (arg == "--threads") {
            if (++i >= argc || !parse_int(argv[i], 1, 256, options.threads)) return false;
        } else if (arg == "--max-audio-tokens") {
            if (++i >= argc || !parse_int(argv[i], 1, 8192, options.max_audio_tokens)) return false;
        } else if (arg == "--top-k") {
            if (++i >= argc || !parse_int(argv[i], 0, 2048, options.top_k)) return false;
        } else if (arg == "--temperature") {
            if (++i >= argc || !parse_float(argv[i], 0.0f, 5.0f, options.temperature)) return false;
        } else if (arg == "--repetition-penalty") {
            if (++i >= argc || !parse_float(argv[i], 0.1f, 10.0f, options.repetition_penalty)) return false;
        } else {
            return false;
        }
    }
    return !options.model_dir.empty() &&
        ((!options.speaker_file.empty() && options.extract_input.empty()) ||
         (options.speaker_file.empty() && !options.extract_input.empty() && !options.extract_output.empty()));
}

void print_usage(const char * program) {
    std::fprintf(stderr,
        "Usage:\n"
        "  %s --model-dir DIR --speaker VOICE.spk [generation options]\n"
        "  %s --model-dir DIR --extract-speaker INPUT.wav OUTPUT.spk [--threads N]\n",
        program, program);
}

bool read_embedding(const std::string & path, std::vector<float> & embedding, std::string & error) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) {
        error = "cannot open speaker embedding";
        return false;
    }
    const std::streamoff length = input.tellg();
    const std::streamoff expected = static_cast<std::streamoff>(sizeof(uint32_t) +
        kEmbeddingSize * sizeof(float));
    if (length != expected) {
        error = "speaker embedding has an invalid size";
        return false;
    }
    input.seekg(0);
    uint32_t count = 0;
    input.read(reinterpret_cast<char *>(&count), sizeof(count));
    if (count != kEmbeddingSize) {
        error = "speaker embedding dimension must be 1024";
        return false;
    }
    embedding.resize(count);
    input.read(reinterpret_cast<char *>(embedding.data()),
               static_cast<std::streamsize>(embedding.size() * sizeof(float)));
    if (!input) {
        error = "cannot read speaker embedding";
        return false;
    }
    if (std::any_of(embedding.begin(), embedding.end(), [](float value) {
            return !std::isfinite(value);
        })) {
        error = "speaker embedding contains non-finite values";
        return false;
    }
    return true;
}

bool write_embedding(const std::string & path, const std::vector<float> & embedding,
                     std::string & error) {
    if (embedding.size() != kEmbeddingSize) {
        error = "extracted speaker embedding dimension is not 1024";
        return false;
    }
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) {
        error = "cannot create speaker embedding";
        return false;
    }
    const uint32_t count = static_cast<uint32_t>(embedding.size());
    output.write(reinterpret_cast<const char *>(&count), sizeof(count));
    output.write(reinterpret_cast<const char *>(embedding.data()),
                 static_cast<std::streamsize>(embedding.size() * sizeof(float)));
    if (!output) {
        error = "cannot write speaker embedding";
        return false;
    }
    return true;
}

void resample_linear(const std::vector<float> & input, int input_rate,
                     std::vector<float> & output, int output_rate) {
    if (input_rate == output_rate) {
        output = input;
        return;
    }
    const double ratio = static_cast<double>(input_rate) / output_rate;
    const size_t output_size = static_cast<size_t>(input.size() / ratio);
    output.resize(output_size);
    for (size_t i = 0; i < output_size; ++i) {
        const double source = i * ratio;
        const size_t left = static_cast<size_t>(source);
        const size_t right = std::min(left + 1, input.size() - 1);
        const double fraction = source - left;
        output[i] = static_cast<float>((1.0 - fraction) * input[left] + fraction * input[right]);
    }
}

void append_u16(std::vector<uint8_t> & output, uint16_t value) {
    output.push_back(static_cast<uint8_t>(value & 0xff));
    output.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
}

void append_u32(std::vector<uint8_t> & output, uint32_t value) {
    output.push_back(static_cast<uint8_t>(value & 0xff));
    output.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
    output.push_back(static_cast<uint8_t>((value >> 16) & 0xff));
    output.push_back(static_cast<uint8_t>((value >> 24) & 0xff));
}

std::vector<uint8_t> encode_wav(const std::vector<float> & samples, int sample_rate) {
    const uint64_t data_size_64 = samples.size() * sizeof(int16_t);
    if (data_size_64 > kMaxAudioBytes || data_size_64 > std::numeric_limits<uint32_t>::max() - 36) {
        return {};
    }
    const uint32_t data_size = static_cast<uint32_t>(data_size_64);
    std::vector<uint8_t> output;
    output.reserve(44 + data_size);
    const auto append_text = [&output](const char * value) {
        output.insert(output.end(), value, value + 4);
    };
    append_text("RIFF");
    append_u32(output, 36 + data_size);
    append_text("WAVE");
    append_text("fmt ");
    append_u32(output, 16);
    append_u16(output, 1);
    append_u16(output, 1);
    append_u32(output, static_cast<uint32_t>(sample_rate));
    append_u32(output, static_cast<uint32_t>(sample_rate * 2));
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

bool valid_request_id(const std::string & value) {
    return !value.empty() && value.size() <= 64 &&
        std::all_of(value.begin(), value.end(), [](unsigned char ch) {
            return std::isalnum(ch) || ch == '-' || ch == '_';
        });
}

void send_payload(const char * type, const std::string & request_id,
                  const std::vector<uint8_t> & payload, int sample_rate = 0) {
    if (sample_rate > 0) {
        std::cout << type << ' ' << request_id << ' ' << sample_rate << ' ' << payload.size() << '\n';
    } else {
        std::cout << type << ' ' << request_id << ' ' << payload.size() << '\n';
    }
    if (!payload.empty()) {
        std::cout.write(reinterpret_cast<const char *>(payload.data()),
                        static_cast<std::streamsize>(payload.size()));
    }
    std::cout.flush();
}

void send_error(const std::string & request_id, const std::string & message) {
    const std::vector<uint8_t> payload(message.begin(), message.end());
    send_payload("ERROR", request_id, payload);
}

int extract_speaker(qwen3_tts::Qwen3TTS & engine, const Options & options) {
    std::vector<float> samples;
    int sample_rate = 0;
    if (!qwen3_tts::load_audio_file(options.extract_input, samples, sample_rate) || samples.empty() ||
        sample_rate < 8000 || sample_rate > 192000) {
        std::fprintf(stderr, "Failed to load a valid reference WAV\n");
        return 1;
    }
    if (samples.size() < static_cast<size_t>(sample_rate) / 2 ||
        samples.size() > static_cast<size_t>(sample_rate) * 60) {
        std::fprintf(stderr, "Reference WAV must be between 0.5 and 60 seconds\n");
        return 1;
    }
    std::vector<float> normalized;
    resample_linear(samples, sample_rate, normalized, 24000);
    std::vector<float> embedding;
    qwen3_tts::tts_params params;
    params.n_threads = options.threads;
    params.print_progress = false;
    params.print_timing = false;
    if (!engine.extract_speaker_embedding(normalized.data(),
                                          static_cast<int32_t>(normalized.size()), embedding, params)) {
        std::fprintf(stderr, "Speaker extraction failed: %s\n", engine.get_error().c_str());
        return 1;
    }
    std::string error;
    if (!write_embedding(options.extract_output, embedding, error)) {
        std::fprintf(stderr, "Speaker extraction failed: %s\n", error.c_str());
        return 1;
    }
    return 0;
}

int serve(qwen3_tts::Qwen3TTS & engine, const Options & options) {
    std::vector<float> embedding;
    std::string embedding_error;
    if (!read_embedding(options.speaker_file, embedding, embedding_error)) {
        std::fprintf(stderr, "Failed to load speaker: %s\n", embedding_error.c_str());
        return 1;
    }

    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    std::cout << "READY 1\n";
    std::cout.flush();

    std::string header;
    while (std::getline(std::cin, header)) {
        std::istringstream stream(header);
        std::string command;
        std::string request_id;
        int language_id = 0;
        size_t text_size = 0;
        std::string trailing;
        if (!(stream >> command >> request_id >> language_id >> text_size) || stream >> trailing ||
            command != "SYNTHESIZE" || !valid_request_id(request_id) ||
            language_id < 1 || language_id > 100000 || text_size == 0 || text_size > kMaxTextBytes) {
            std::fprintf(stderr, "Invalid request header\n");
            return 2;
        }
        std::string text(text_size, '\0');
        std::cin.read(text.data(), static_cast<std::streamsize>(text_size));
        if (static_cast<size_t>(std::cin.gcount()) != text_size) {
            std::fprintf(stderr, "Truncated request payload\n");
            return 2;
        }

        qwen3_tts::tts_params params;
        params.n_threads = options.threads;
        params.max_audio_tokens = options.max_audio_tokens;
        params.top_k = options.top_k;
        params.temperature = options.temperature;
        params.repetition_penalty = options.repetition_penalty;
        params.language_id = language_id;
        params.print_progress = false;
        params.print_timing = true;
        const qwen3_tts::tts_result result = engine.synthesize_with_embedding(
            text, embedding.data(), static_cast<int32_t>(embedding.size()), params);
        if (!result.success) {
            send_error(request_id, result.error_msg.empty() ? "speech synthesis failed" : result.error_msg);
            continue;
        }
        std::vector<uint8_t> wav = encode_wav(result.audio, result.sample_rate);
        if (wav.empty()) {
            send_error(request_id, "generated audio exceeds the output size limit");
            continue;
        }
        send_payload("RESULT", request_id, wav, result.sample_rate);
    }
    return 0;
}

} // namespace

int main(int argc, char ** argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    Options options;
    if (!parse_options(argc, argv, options)) {
        print_usage(argv[0]);
        return 2;
    }

#ifdef _WIN32
    _putenv_s("QWEN3_TTS_BACKEND", "cpu");
#else
    setenv("QWEN3_TTS_BACKEND", "cpu", 1);
#endif

    qwen3_tts::Qwen3TTS engine;
    if (!engine.load_models(options.model_dir)) {
        std::fprintf(stderr, "Failed to load Qwen3-TTS models: %s\n", engine.get_error().c_str());
        return 1;
    }
    return options.extract_input.empty() ? serve(engine, options) : extract_speaker(engine, options);
}
