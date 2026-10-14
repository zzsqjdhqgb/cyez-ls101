// ls101 IndexTTS 2.5 helper.
//
// One process loads one IndexTTS2 model and one session. The voice reference WAV is
// chosen per request, so all voices share one copy of the weights in memory.
// Emotion always follows the voice reference: no emotion text, audio, or vector is
// ever requested, so the Qwen emotion model is never staged on the device.
//
// Protocol (binary-safe; requests are served strictly one at a time):
//   helper -> host : "READY 1\n"
//   host -> helper : "SYNTHESIZE <id> <seed> <language> <voicePathBytes> <textBytes>\n"
//                    then voicePathBytes of UTF-8 path, then textBytes of UTF-8 text
//   helper -> host : "RESULT <id> <sampleRate> <bytes>\n<wav bytes>"
//                  | "ERROR <id> <bytes>\n<utf-8 message>"

#include "audiocpp.h"
#include "engine/framework/audio/wav_reader.h"
#include "ggml-backend.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <filesystem>
#include <iostream>
#include <limits>
#include <list>
#include <locale>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

constexpr size_t kMaxTextBytes = 64 * 1024;
constexpr size_t kMaxPathBytes = 32 * 1024;
constexpr size_t kMaxAudioBytes = 200 * 1024 * 1024;
constexpr size_t kMaxCachedVoices = 16;

struct Options {
    std::string backend;
    std::string probe_backend;
    std::string model_file;
    std::string weight_type = "f16";
    int threads = 4;
    int max_tokens = 0;
    int top_k = 0;
    float top_p = -1.0f;
    float temperature = -1.0f;
    bool mem_saver = false;
    int speaker_cache_slots = 4;
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
    std::istringstream stream(value);
    stream.imbue(std::locale::classic());
    float parsed = 0.0f;
    stream >> parsed;
    if (stream.fail() || !stream.eof() || !std::isfinite(parsed) || parsed < min || parsed > max) {
        return false;
    }
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
        if (arg == "--backend") {
            if (!next_value(argc, argv, i, options.backend) ||
                (options.backend != "cpu" && options.backend != "cuda")) return false;
        } else if (arg == "--probe-backend") {
            if (!next_value(argc, argv, i, options.probe_backend) ||
                options.probe_backend != "cuda") return false;
        } else if (arg == "--model") {
            if (!next_value(argc, argv, i, options.model_file)) return false;
        } else if (arg == "--weight-type") {
            if (!next_value(argc, argv, i, options.weight_type) ||
                (options.weight_type != "f16" && options.weight_type != "f32" &&
                 options.weight_type != "native")) return false;
        } else if (arg == "--threads") {
            if (++i >= argc || !parse_int(argv[i], 1, 256, options.threads)) return false;
        } else if (arg == "--max-tokens") {
            if (++i >= argc || !parse_int(argv[i], 1, 8192, options.max_tokens)) return false;
        } else if (arg == "--top-k") {
            if (++i >= argc || !parse_int(argv[i], 1, 2048, options.top_k)) return false;
        } else if (arg == "--top-p") {
            if (++i >= argc || !parse_float(argv[i], 0.0f, 1.0f, options.top_p)) return false;
        } else if (arg == "--temperature") {
            if (++i >= argc || !parse_float(argv[i], 0.01f, 5.0f, options.temperature)) return false;
        } else if (arg == "--mem-saver") {
            if (!next_value(argc, argv, i, value) || (value != "0" && value != "1")) return false;
            options.mem_saver = value == "1";
        } else if (arg == "--speaker-cache-slots") {
            if (++i >= argc || !parse_int(argv[i], 1, 64, options.speaker_cache_slots)) return false;
        } else {
            return false;
        }
    }
    if (!options.probe_backend.empty()) {
        return options.backend.empty() && options.model_file.empty();
    }
    return !options.backend.empty() && !options.model_file.empty();
}

void print_usage(const char * program) {
    std::fprintf(stderr,
        "Usage:\n"
        "  %s --backend cpu|cuda --model INDEX_TTS2.gguf [--threads N] [--mem-saver 0|1]\n"
        "     [--weight-type f16|f32|native] [--speaker-cache-slots N] [--max-tokens N]\n"
        "     [--top-k N] [--top-p P] [--temperature T]\n"
        "  %s --probe-backend cuda\n",
        program, program);
}

std::string json_escape(const char * value) {
    std::string escaped;
    if (!value) return escaped;
    for (const unsigned char character : std::string(value)) {
        switch (character) {
            case '\\': escaped += "\\\\"; break;
            case '"': escaped += "\\\""; break;
            case '\n': escaped += "\\n"; break;
            case '\r': escaped += "\\r"; break;
            case '\t': escaped += "\\t"; break;
            default:
                if (character < 0x20) {
                    char buffer[7];
                    std::snprintf(buffer, sizeof(buffer), "\\u%04x", character);
                    escaped += buffer;
                } else {
                    escaped += static_cast<char>(character);
                }
        }
    }
    return escaped;
}

bool is_cuda_device(ggml_backend_dev_t device) {
    ggml_backend_reg_t registry = ggml_backend_dev_backend_reg(device);
    const char * name = registry ? ggml_backend_reg_name(registry) : nullptr;
    return name && std::strcmp(name, "CUDA") == 0;
}

bool probe_cuda_backend(bool emit_result) {
    const size_t device_count = ggml_backend_dev_count();
    for (size_t index = 0; index < device_count; ++index) {
        ggml_backend_dev_t device = ggml_backend_dev_get(index);
        if (!is_cuda_device(device)) continue;
        ggml_backend_t backend = ggml_backend_dev_init(device, nullptr);
        if (!backend) continue;
        size_t memory_free = 0;
        size_t memory_total = 0;
        ggml_backend_dev_memory(device, &memory_free, &memory_total);
        if (emit_result) {
            std::printf(
                "{\"available\":true,\"backend\":\"cuda\",\"device\":\"%s\","
                "\"description\":\"%s\",\"memoryFree\":%zu,\"memoryTotal\":%zu}\n",
                json_escape(ggml_backend_dev_name(device)).c_str(),
                json_escape(ggml_backend_dev_description(device)).c_str(),
                memory_free, memory_total);
        }
        ggml_backend_free(backend);
        return true;
    }
    if (emit_result) {
        std::printf(
            "{\"available\":false,\"backend\":\"cuda\","
            "\"message\":\"CUDA backend or device is unavailable\"}\n");
    }
    return false;
}

std::string last_error(audiocpp_status status) {
    const char * detail = audiocpp_last_error();
    if (detail && *detail) return detail;
    return audiocpp_status_string(status);
}

void append_u16(std::vector<uint8_t> & output, uint16_t value) {
    output.push_back(static_cast<uint8_t>(value & 0xff));
    output.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
}

void append_u32(std::vector<uint8_t> & output, uint32_t value) {
    for (int shift = 0; shift < 32; shift += 8) {
        output.push_back(static_cast<uint8_t>((value >> shift) & 0xff));
    }
}

// Mono 16-bit PCM WAV; multi-channel output is averaged.
std::vector<uint8_t> encode_wav(const float * samples, size_t frames, int channels, int sample_rate) {
    const uint64_t data_size_64 = static_cast<uint64_t>(frames) * sizeof(int16_t);
    if (channels < 1 || sample_rate <= 0 || data_size_64 > kMaxAudioBytes) return {};
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
    append_u32(output, static_cast<uint32_t>(sample_rate) * 2);
    append_u16(output, 2);
    append_u16(output, 16);
    append_text("data");
    append_u32(output, data_size);
    for (size_t frame = 0; frame < frames; ++frame) {
        float sum = 0.0f;
        for (int channel = 0; channel < channels; ++channel) {
            const float value = samples[frame * static_cast<size_t>(channels) + channel];
            sum += std::isfinite(value) ? value : 0.0f;
        }
        const float clamped = std::max(-1.0f, std::min(1.0f, sum / static_cast<float>(channels)));
        append_u16(output, static_cast<uint16_t>(static_cast<int16_t>(std::lrint(clamped * 32767.0f))));
    }
    return output;
}

bool valid_token(const std::string & value, size_t max_size) {
    return !value.empty() && value.size() <= max_size &&
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

std::filesystem::path utf8_path(const std::string & value) {
#if defined(__cpp_char8_t)
    return std::filesystem::path(std::u8string(value.begin(), value.end()));
#else
    return std::filesystem::u8path(value);
#endif
}

// LRU of decoded reference WAVs keyed by path, so switching voices does not re-read
// files. Speaker conditioning features are cached separately inside audio.cpp.
class VoiceCache {
public:
    const engine::audio::WavData & get(const std::string & path) {
        for (auto it = entries_.begin(); it != entries_.end(); ++it) {
            if (it->first == path) {
                entries_.splice(entries_.begin(), entries_, it);
                return entries_.front().second;
            }
        }
        engine::audio::WavData wav = engine::audio::read_wav_f32(utf8_path(path));
        if (wav.samples.empty() || wav.channels < 1 || wav.sample_rate < 8000 ||
            wav.sample_rate > 192000) {
            throw std::runtime_error("voice reference WAV is empty or has an unsupported format");
        }
        const size_t frames = wav.samples.size() / static_cast<size_t>(wav.channels);
        if (frames < static_cast<size_t>(wav.sample_rate) / 2 ||
            frames > static_cast<size_t>(wav.sample_rate) * 60) {
            throw std::runtime_error("voice reference WAV must be between 0.5 and 60 seconds");
        }
        entries_.emplace_front(path, std::move(wav));
        while (entries_.size() > kMaxCachedVoices) entries_.pop_back();
        return entries_.front().second;
    }

private:
    std::list<std::pair<std::string, engine::audio::WavData>> entries_;
};

struct Engine {
    audiocpp_registry * registry = nullptr;
    audiocpp_model * model = nullptr;
    audiocpp_session * session = nullptr;

    Engine() = default;
    Engine(const Engine &) = delete;
    Engine & operator=(const Engine &) = delete;
    ~Engine() {
        audiocpp_session_free(session);
        audiocpp_model_free(model);
        audiocpp_registry_free(registry);
    }
};

void check(audiocpp_status status, const char * stage) {
    if (status != AUDIOCPP_OK) {
        throw std::runtime_error(std::string(stage) + ": " + last_error(status));
    }
}

class OptionsHandle {
public:
    OptionsHandle() : handle_(audiocpp_options_create()) {
        if (!handle_) throw std::runtime_error("failed to allocate audio.cpp options");
    }
    OptionsHandle(const OptionsHandle &) = delete;
    OptionsHandle & operator=(const OptionsHandle &) = delete;
    ~OptionsHandle() { audiocpp_options_free(handle_); }
    void set(const char * key, const std::string & value) {
        check(audiocpp_options_set(handle_, key, value.c_str()), "set option");
    }
    audiocpp_options * get() const { return handle_; }

private:
    audiocpp_options * handle_;
};

void load_engine(const Options & options, Engine & engine) {
    check(audiocpp_registry_create(nullptr, &engine.registry), "create registry");
    audiocpp_model_config config{"index_tts2", nullptr, nullptr, nullptr};
    check(audiocpp_model_load(engine.registry, options.model_file.c_str(), &config, nullptr,
                              &engine.model),
          "load model");

    OptionsHandle session_options;
    session_options.set("index_tts2.weight_type", options.weight_type);
    session_options.set("index_tts2.mem_saver", options.mem_saver ? "true" : "false");
    session_options.set("index_tts2.speaker_cache_slots",
                        std::to_string(options.speaker_cache_slots));
    audiocpp_backend_config backend{options.backend.c_str(), 0, options.threads};
    // "clon": the voice reference is always supplied per request.
    check(audiocpp_session_create(engine.model, "clon", "offline", &backend,
                                  session_options.get(), &engine.session),
          "create session");
}

class RequestHandle {
public:
    RequestHandle() : handle_(audiocpp_request_create()) {
        if (!handle_) throw std::runtime_error("failed to allocate audio.cpp request");
    }
    RequestHandle(const RequestHandle &) = delete;
    RequestHandle & operator=(const RequestHandle &) = delete;
    ~RequestHandle() { audiocpp_request_free(handle_); }
    audiocpp_request * get() const { return handle_; }

private:
    audiocpp_request * handle_;
};

class ResultHandle {
public:
    ResultHandle() = default;
    ResultHandle(const ResultHandle &) = delete;
    ResultHandle & operator=(const ResultHandle &) = delete;
    ~ResultHandle() { audiocpp_result_free(handle_); }
    audiocpp_result ** out() { return &handle_; }
    const audiocpp_result * get() const { return handle_; }

private:
    audiocpp_result * handle_ = nullptr;
};

std::string format_float(float value) {
    std::ostringstream stream;
    stream.imbue(std::locale::classic());
    stream << value;
    return stream.str();
}

std::vector<uint8_t> synthesize(const Options & options, Engine & engine, VoiceCache & voices,
                                uint32_t seed, const std::string & language,
                                const std::string & voice_path, const std::string & text,
                                int & sample_rate) {
    const engine::audio::WavData & voice = voices.get(voice_path);
    RequestHandle request;
    check(audiocpp_request_set_text(request.get(), text.c_str(),
                                    language == "auto" ? nullptr : language.c_str()),
          "set text");
    check(audiocpp_request_set_voice_audio(
              request.get(), voice.samples.data(),
              voice.samples.size() / static_cast<size_t>(voice.channels), voice.sample_rate,
              voice.channels),
          "set voice");
    check(audiocpp_request_set_option(request.get(), "seed", std::to_string(seed).c_str()),
          "set seed");
    if (options.max_tokens > 0) {
        check(audiocpp_request_set_option(request.get(), "max_tokens",
                                          std::to_string(options.max_tokens).c_str()),
              "set max_tokens");
    }
    if (options.top_k > 0) {
        check(audiocpp_request_set_option(request.get(), "top_k",
                                          std::to_string(options.top_k).c_str()),
              "set top_k");
    }
    if (options.top_p > 0.0f) {
        check(audiocpp_request_set_option(request.get(), "top_p",
                                          format_float(options.top_p).c_str()),
              "set top_p");
    }
    if (options.temperature > 0.0f) {
        check(audiocpp_request_set_option(request.get(), "temperature",
                                          format_float(options.temperature).c_str()),
              "set temperature");
    }

    ResultHandle result;
    check(audiocpp_session_run(engine.session, request.get(), result.out()), "synthesize");
    const float * samples = nullptr;
    size_t frames = 0;
    int channels = 0;
    check(audiocpp_result_audio(result.get(), &samples, &frames, &sample_rate, &channels),
          "read audio");
    if (!samples || frames == 0) throw std::runtime_error("IndexTTS returned no audio");
    std::vector<uint8_t> wav = encode_wav(samples, frames, channels, sample_rate);
    if (wav.empty()) throw std::runtime_error("generated audio is too large or invalid");
    return wav;
}

bool read_exact(std::string & output, size_t size) {
    output.assign(size, '\0');
    std::cin.read(output.data(), static_cast<std::streamsize>(size));
    return static_cast<size_t>(std::cin.gcount()) == size;
}

int serve(const Options & options, Engine & engine) {
    VoiceCache voices;
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    std::cout << "READY 1\n";
    std::cout.flush();

    std::string header;
    while (std::getline(std::cin, header)) {
        std::istringstream stream(header);
        stream.imbue(std::locale::classic());
        std::string command;
        std::string request_id;
        uint64_t seed = 0;
        std::string language;
        size_t path_size = 0;
        size_t text_size = 0;
        std::string trailing;
        if (!(stream >> command >> request_id >> seed >> language >> path_size >> text_size) ||
            stream >> trailing || command != "SYNTHESIZE" || !valid_token(request_id, 128) ||
            seed > std::numeric_limits<uint32_t>::max() || !valid_token(language, 16) ||
            path_size == 0 || path_size > kMaxPathBytes || text_size == 0 ||
            text_size > kMaxTextBytes) {
            std::fprintf(stderr, "Invalid request header\n");
            return 2;
        }
        std::string voice_path;
        std::string text;
        if (!read_exact(voice_path, path_size) || !read_exact(text, text_size)) {
            std::fprintf(stderr, "Truncated request payload\n");
            return 2;
        }
        try {
            int sample_rate = 0;
            const std::vector<uint8_t> wav =
                synthesize(options, engine, voices, static_cast<uint32_t>(seed), language,
                           voice_path, text, sample_rate);
            send_payload("RESULT", request_id, wav, sample_rate);
        } catch (const std::exception & error) {
            send_error(request_id, error.what());
        }
    }
    return 0;
}

}  // namespace

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
    if (!options.probe_backend.empty()) {
        return probe_cuda_backend(true) ? 0 : 1;
    }
    if (options.backend == "cuda" && !probe_cuda_backend(false)) {
        std::fprintf(stderr, "CUDA backend or device is unavailable\n");
        return 1;
    }

    try {
        Engine engine;
        load_engine(options, engine);
        return serve(options, engine);
    } catch (const std::exception & error) {
        std::fprintf(stderr, "Failed to start IndexTTS: %s\n", error.what());
        return 1;
    }
}
