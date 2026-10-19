// ls101-index-tts-helper: bridges the Electron main process to audio.cpp's
// index_tts2 family through the C ABI in include/audiocpp.h.
//
// Wire protocol (stdin/stdout, binary safe, requests strictly serialized):
//   helper -> host : "READY 1\n"
//   host -> helper : "SYNTHESIZE <id> <payloadBytes>\n" + JSON payload
//   helper -> host : "RESULT <id> <sampleRate> <wavBytes>\n" + WAV bytes
//                  | "ERROR <id> <messageBytes>\n" + UTF-8 message
//
// A per-request failure (bad payload, unreadable reference audio, rejected
// synthesis) answers ERROR and keeps serving. Fatal conditions - a malformed
// frame, a failing engine, a broken stdout - exit 1 with stderr diagnostics.
//
// The JSON payload requires text, voicePath, language and maxTokens, and
// accepts optional seed, durationFactor, temperature, topP and topK fields
// that map onto audio.cpp index_tts2 request options.
//
// Emotion policy: all emotion conditioning paths are deliberately closed.
// End-to-end evaluation showed the engine's emotion controls destabilize
// voice cloning - the Qwen classifier's all-zero fallback on neutral text
// forces a natural=1 spike vector that drifts the timbre away from the
// reference, explicit vectors distort the timbre the same way, and emotion
// reference audio transfers its pace. The helper therefore accepts no
// emotion fields at all: every request synthesizes with the reference
// audio's own emotion.

#include "audio.h"
#include "audiocpp.h"
#include "cJSON.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#include <shellapi.h>
#endif

namespace {

constexpr size_t kMaxHeaderBytes = 4096;
constexpr size_t kMaxPayloadBytes = 512 * 1024;
constexpr size_t kMaxTextBytes = 64 * 1024;
constexpr size_t kMaxResultBytes = 100 * 1024 * 1024;

struct Options {
    std::string model_path;
    std::string backend = "cpu";
    int threads = 4;
    int device = 0;
    int low_memory = 1;
};

struct RequestPayload {
    std::string text;
    std::string voice_path;
    std::string language;
    int max_tokens = 0;
    bool has_seed = false;
    uint64_t seed = 0;
    // Optional speech-rate / sampling controls. Emotion conditioning is
    // deliberately absent (see the header comment): requests always
    // synthesize with the reference audio's own emotion.
    bool has_duration_factor = false;
    double duration_factor = 0.0;
    bool has_temperature = false;
    double temperature = 0.0;
    bool has_top_p = false;
    double top_p = 0.0;
    bool has_top_k = false;
    int top_k = 0;
};

bool is_absolute_path(const std::string & value) {
    if (value.empty()) return false;
    std::error_code ec;
    return std::filesystem::path(value).is_absolute();
}

bool valid_request_id(const std::string & value) {
    return !value.empty() && value.size() <= 64 &&
        std::all_of(value.begin(), value.end(), [](unsigned char ch) {
            return std::isalnum(ch) || ch == '-' || ch == '_';
        });
}

bool parse_int_value(const char * value, int min, int max, int & output) {
    if (!value || !*value) return false;
    char * end = nullptr;
    const long long parsed = std::strtoll(value, &end, 10);
    if (*end != '\0' || parsed < min || parsed > max) return false;
    output = static_cast<int>(parsed);
    return true;
}

// argc/argv are normalized to UTF-8 on Windows and to plain char** elsewhere.
char ** acquire_arguments(int & argc) {
#ifdef _WIN32
    wchar_t ** wide = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (wide == nullptr) return nullptr;
    char ** argv = static_cast<char **>(std::calloc(argc + 1, sizeof(char *)));
    if (argv == nullptr) return nullptr;
    for (int index = 0; index < argc; ++index) {
        const int bytes = WideCharToMultiByte(
            CP_UTF8, WC_ERR_INVALID_CHARS, wide[index], -1, nullptr, 0, nullptr, nullptr);
        if (bytes <= 0) {
            argv[index] = static_cast<char *>(std::calloc(1, 1));
            continue;
        }
        argv[index] = static_cast<char *>(std::calloc(bytes + 1, sizeof(char)));
        WideCharToMultiByte(
            CP_UTF8, WC_ERR_INVALID_CHARS, wide[index], -1, argv[index], bytes, nullptr, nullptr);
    }
    LocalFree(wide);
    return argv;
#else
    return nullptr;
#endif
}

void release_arguments(int argc, char ** argv) {
#ifdef _WIN32
    if (argv == nullptr) return;
    for (int index = 0; index < argc; ++index) std::free(argv[index]);
    std::free(argv);
#else
    (void)argc;
    (void)argv;
#endif
}

bool parse_options(int argc, char ** argv, Options & options, std::string & error) {
    bool have_model = false;
    bool have_backend = false;
    bool have_threads = false;
    bool have_device = false;
    bool have_low_memory = false;
    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        const bool needs_value = argument == "--model" || argument == "--backend" ||
            argument == "--threads" || argument == "--device" || argument == "--low-memory";
        if (!needs_value) {
            error = "unknown argument: " + argument;
            return false;
        }
        if (index + 1 >= argc) {
            error = argument + " requires a value";
            return false;
        }
        const std::string value = argv[index + 1];
        index += 1;
        if (argument == "--model") {
            if (have_model) {
                error = "--model must be given once";
                return false;
            }
            have_model = true;
            options.model_path = value;
        } else if (argument == "--backend") {
            if (have_backend) {
                error = "--backend must be given once";
                return false;
            }
            have_backend = true;
            if (value != "cpu" && value != "cuda") {
                error = "--backend must be cpu or cuda";
                return false;
            }
            options.backend = value;
        } else if (argument == "--threads") {
            if (have_threads) {
                error = "--threads must be given once";
                return false;
            }
            have_threads = true;
            if (!parse_int_value(value.c_str(), 1, 256, options.threads)) {
                error = "--threads must be an integer between 1 and 256";
                return false;
            }
        } else if (argument == "--device") {
            if (have_device) {
                error = "--device must be given once";
                return false;
            }
            have_device = true;
            if (!parse_int_value(value.c_str(), 0, 31, options.device)) {
                error = "--device must be an integer between 0 and 31";
                return false;
            }
        } else {
            if (have_low_memory) {
                error = "--low-memory must be given once";
                return false;
            }
            have_low_memory = true;
            if (!parse_int_value(value.c_str(), 0, 1, options.low_memory)) {
                error = "--low-memory must be 0 or 1";
                return false;
            }
        }
    }
    if (!have_model || options.model_path.empty()) {
        // The exact message is part of the CI smoke contract.
        error = "An absolute --model path is required";
        return false;
    }
    if (!is_absolute_path(options.model_path)) {
        error = "An absolute --model path is required";
        return false;
    }
    return true;
}

void print_usage(const char * program) {
    std::fprintf(
        stderr,
        "Usage:\n"
        "  %s --model ABSOLUTE_MODEL_PATH [--backend cpu|cuda] [--threads N] "
        "[--device N] [--low-memory 0|1]\n",
        program);
}

std::string json_escape(const std::string & value) {
    std::string escaped;
    for (const unsigned char character : value) {
        switch (character) {
            case '\\': escaped += "\\\\"; break;
            case '"': escaped += "\\\""; break;
            case '\b': escaped += "\\b"; break;
            case '\f': escaped += "\\f"; break;
            case '\n': escaped += "\\n"; break;
            case '\r': escaped += "\\r"; break;
            case '\t': escaped += "\\t"; break;
            default:
                if (character < 0x20) {
                    char buffer[8];
                    std::snprintf(buffer, sizeof(buffer), "\\u%04x", character);
                    escaped += buffer;
                } else {
                    escaped += static_cast<char>(character);
                }
        }
    }
    return escaped;
}

bool payload_contains_nul(const char * payload, size_t length) {
    return std::memchr(payload, 0, length) != nullptr;
}

bool payload_contains_escaped_nul(const char * payload, size_t length) {
    if (length < 6) return false;
    for (size_t index = 0; index + 5 < length; ++index) {
        if (payload[index] != '\\' || payload[index + 1] != 'u') continue;
        if (std::tolower(static_cast<unsigned char>(payload[index + 2])) != '0' ||
            std::tolower(static_cast<unsigned char>(payload[index + 3])) != '0' ||
            std::tolower(static_cast<unsigned char>(payload[index + 4])) != '0' ||
            std::tolower(static_cast<unsigned char>(payload[index + 5])) != '0') {
            continue;
        }
        return true;
    }
    return false;
}

bool integer_in_range(const cJSON * item, double min, double max, double & output) {
    if (!cJSON_IsNumber(item)) return false;
    const double value = item->valuedouble;
    if (!std::isfinite(value) || std::trunc(value) != value || value < min || value > max) {
        return false;
    }
    output = value;
    return true;
}

bool double_in_range(const cJSON * item, double min, double max, double & output) {
    if (!cJSON_IsNumber(item)) return false;
    const double value = item->valuedouble;
    if (!std::isfinite(value) || value < min || value > max) {
        return false;
    }
    output = value;
    return true;
}

bool parse_payload(const char * payload, size_t length, RequestPayload & out, std::string & error) {
    const cJSON * root = cJSON_ParseWithLength(payload, length);
    if (root == nullptr) {
        error = "request payload is not valid JSON";
        return false;
    }
    std::string failure;
    const cJSON * node = root->child;
    bool have_text = false;
    bool have_voice = false;
    bool have_language = false;
    bool have_max_tokens = false;
    while (node != nullptr) {
        const char * key = node->string ? node->string : "";
        if (std::strcmp(key, "text") == 0) {
            if (have_text || !cJSON_IsString(node) || node->valuestring == nullptr) {
                failure = "text must be a string given once";
                break;
            }
            have_text = true;
            out.text = node->valuestring;
        } else if (std::strcmp(key, "voicePath") == 0) {
            if (have_voice || !cJSON_IsString(node) || node->valuestring == nullptr) {
                failure = "voicePath must be a string given once";
                break;
            }
            have_voice = true;
            out.voice_path = node->valuestring;
        } else if (std::strcmp(key, "language") == 0) {
            if (have_language || !cJSON_IsString(node) || node->valuestring == nullptr) {
                failure = "language must be a string given once";
                break;
            }
            have_language = true;
            out.language = node->valuestring;
        } else if (std::strcmp(key, "maxTokens") == 0) {
            double value = 0.0;
            if (have_max_tokens || !integer_in_range(node, 1, 8192, value)) {
                failure = "maxTokens must be an integer between 1 and 8192";
                break;
            }
            have_max_tokens = true;
            out.max_tokens = static_cast<int>(value);
        } else if (std::strcmp(key, "seed") == 0) {
            double value = 0.0;
            if (out.has_seed || !integer_in_range(node, 0, 4294967295.0, value)) {
                failure = "seed must be an integer between 0 and 4294967295";
                break;
            }
            out.has_seed = true;
            out.seed = static_cast<uint64_t>(value);
        } else if (std::strcmp(key, "durationFactor") == 0) {
            if (out.has_duration_factor || !double_in_range(node, 0.1, 10.0, out.duration_factor)) {
                failure = "durationFactor must be a number in [0.1, 10] given once";
                break;
            }
            out.has_duration_factor = true;
        } else if (std::strcmp(key, "temperature") == 0) {
            if (out.has_temperature || !double_in_range(node, 0.01, 5.0, out.temperature)) {
                failure = "temperature must be a number in [0.01, 5] given once";
                break;
            }
            out.has_temperature = true;
        } else if (std::strcmp(key, "topP") == 0) {
            if (out.has_top_p || !double_in_range(node, 0.0001, 1.0, out.top_p)) {
                failure = "topP must be a number in [0.0001, 1] given once";
                break;
            }
            out.has_top_p = true;
        } else if (std::strcmp(key, "topK") == 0) {
            double value = 0.0;
            if (out.has_top_k || !integer_in_range(node, 1, 1000, value)) {
                failure = "topK must be an integer between 1 and 1000 given once";
                break;
            }
            out.has_top_k = true;
            out.top_k = static_cast<int>(value);
        } else {
            failure = std::string("unknown payload field: ") + key;
            break;
        }
        node = node->next;
    }
    cJSON_Delete(const_cast<cJSON *>(root));
    if (!failure.empty()) {
        error = failure;
        return false;
    }
    if (!have_text || !have_voice || !have_language || !have_max_tokens) {
        error = "payload requires text, voicePath, language and maxTokens";
        return false;
    }
    if (out.text.empty() || out.text.size() > kMaxTextBytes) {
        error = "text must be between 1 and 65536 UTF-8 bytes";
        return false;
    }
    if (!is_absolute_path(out.voice_path)) {
        error = "voicePath must be an absolute path";
        return false;
    }
    const char * const languages[] = {"auto", "zh", "en", "ja", "es", "ar"};
    if (std::none_of(std::begin(languages), std::end(languages), [&](const char * candidate) {
            return out.language == candidate;
        })) {
        error = "language must be one of auto, zh, en, ja, es, ar";
        return false;
    }
    return true;
}

bool write_all(const void * data, size_t length) {
    if (length == 0) return true;
    return std::fwrite(data, 1, length, stdout) == length;
}

bool send_result(const std::string & request_id, const std::vector<uint8_t> & wav, int sample_rate) {
    if (wav.empty() || wav.size() > kMaxResultBytes) return false;
    if (std::fprintf(stdout, "RESULT %s %d %zu\n", request_id.c_str(), sample_rate, wav.size()) < 0) {
        return false;
    }
    if (!write_all(wav.data(), wav.size())) return false;
    return std::fflush(stdout) == 0;
}

bool send_error(const std::string & request_id, const std::string & message) {
    if (message.size() > kMaxHeaderBytes) return false;
    if (std::fprintf(stdout, "ERROR %s %zu\n", request_id.c_str(), message.size()) < 0) {
        return false;
    }
    if (!write_all(message.data(), message.size())) return false;
    return std::fflush(stdout) == 0;
}

std::string abi_error(uint32_t actual) {
    char buffer[96];
    std::snprintf(
        buffer,
        sizeof(buffer),
        "audio.cpp ABI mismatch: runtime %u.%u.%u, built against %d.%d.%d",
        actual >> 16,
        (actual >> 8) & 0xff,
        actual & 0xff,
        AUDIOCPP_ABI_VERSION_MAJOR,
        AUDIOCPP_ABI_VERSION_MINOR,
        AUDIOCPP_ABI_VERSION_PATCH);
    return buffer;
}

struct Engine {
    audiocpp_registry * registry = nullptr;
    audiocpp_model * model = nullptr;
    audiocpp_session * session = nullptr;

    ~Engine() {
        if (session != nullptr) audiocpp_session_free(session);
        if (model != nullptr) audiocpp_model_free(model);
        if (registry != nullptr) audiocpp_registry_free(registry);
    }
};

bool check_status(audiocpp_status status, const char * action) {
    if (status == AUDIOCPP_OK) return true;
    const char * detail = audiocpp_last_error();
    std::fprintf(
        stderr,
        "%s failed (%s): %s\n",
        action,
        audiocpp_status_string(status),
        detail ? detail : "no detail");
    return false;
}

} // namespace

int main(int argc, char ** argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    int argument_count = argc;
    char ** arguments = argv;
    char ** owned = acquire_arguments(argument_count);
    if (owned != nullptr) arguments = owned;

    Options options;
    std::string options_error;
    if (!parse_options(argument_count, arguments, options, options_error)) {
        std::fprintf(stderr, "%s\n", options_error.c_str());
        print_usage(arguments[0]);
        release_arguments(argument_count, owned);
        return 1;
    }
    release_arguments(argument_count, owned);

    // The ABI is versioned as (major << 16) | (minor << 8) | patch. A helper
    // may run against a runtime with a newer minor (entry points were added)
    // but never against a different major or an older minor.
    const uint32_t abi = audiocpp_abi_version();
    const uint32_t runtime_major = abi >> 16;
    const uint32_t runtime_minor = (abi >> 8) & 0xff;
    if (runtime_major != AUDIOCPP_ABI_VERSION_MAJOR ||
        runtime_minor < AUDIOCPP_ABI_VERSION_MINOR) {
        std::fprintf(stderr, "%s\n", abi_error(abi).c_str());
        return 1;
    }

    Engine engine;
    if (!check_status(
            audiocpp_registry_create(nullptr, &engine.registry), "audiocpp_registry_create")) {
        return 1;
    }
    const audiocpp_model_config model_config{"index_tts2", nullptr, nullptr, nullptr};
    if (!check_status(
            audiocpp_model_load(
                engine.registry, options.model_path.c_str(), &model_config, nullptr, &engine.model),
            "audiocpp_model_load")) {
        return 1;
    }
    const char * family = audiocpp_model_family(engine.model);
    const char * description = audiocpp_model_description(engine.model);
    if (family == nullptr || std::strcmp(family, "index_tts2") != 0) {
        std::fprintf(
            stderr,
            "unexpected audio.cpp model family: %s\n",
            family ? family : "(null)");
        return 1;
    }
    if (description == nullptr || std::strstr(description, "IndexTTS2.5") == nullptr) {
        std::fprintf(
            stderr,
            "the loaded index_tts2 model is not an IndexTTS2.5 package: %s\n",
            description ? description : "(null)");
        return 1;
    }

    audiocpp_options * session_options = audiocpp_options_create();
    if (session_options == nullptr) {
        std::fprintf(stderr, "audiocpp_options_create failed\n");
        return 1;
    }
    audiocpp_options_set(session_options, "index_tts2.mem_saver", options.low_memory ? "true" : "false");
    audiocpp_options_set(session_options, "index_tts2.speaker_cache_slots", "1");
    audiocpp_options_set(session_options, "index_tts2.emotion_cache_slots", "1");
    audiocpp_options_set(session_options, "index_tts2.emotion_text_cache_slots", "1");
    const audiocpp_backend_config backend_config{
        options.backend.c_str(), options.device, options.threads};
    const audiocpp_status session_status = audiocpp_session_create(
        engine.model,
        "tts",
        "offline",
        &backend_config,
        session_options,
        &engine.session);
    audiocpp_options_free(session_options);
    if (!check_status(session_status, "audiocpp_session_create")) {
        return 1;
    }

    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    if (std::printf("READY 1\n") < 0 || std::fflush(stdout) != 0) {
        std::fprintf(stderr, "cannot write the READY frame\n");
        return 1;
    }

    std::string header;
    while (std::getline(std::cin, header)) {
        if (!header.empty() && header.back() == '\r') header.pop_back();
        if (header.size() > kMaxHeaderBytes) {
            std::fprintf(stderr, "request header exceeds the size limit\n");
            return 1;
        }
        // Exactly three fields: SYNTHESIZE, request id, payload byte count.
        size_t first = header.find(' ');
        size_t second = first == std::string::npos ? std::string::npos
            : header.find(' ', first + 1);
        size_t third = second == std::string::npos ? std::string::npos
            : header.find(' ', second + 1);
        if (first == std::string::npos || second == std::string::npos || third != std::string::npos ||
            header.compare(0, first, "SYNTHESIZE") != 0) {
            std::fprintf(stderr, "invalid request header\n");
            return 1;
        }
        const std::string request_id = header.substr(first + 1, second - first - 1);
        const std::string size_field = header.substr(second + 1);
        char * size_end = nullptr;
        const unsigned long long payload_size = std::strtoull(size_field.c_str(), &size_end, 10);
        if (size_field.empty() || *size_end != '\0' || payload_size == 0 ||
            payload_size > kMaxPayloadBytes) {
            std::fprintf(stderr, "invalid request payload size\n");
            return 1;
        }
        if (!valid_request_id(request_id)) {
            std::fprintf(stderr, "invalid request id\n");
            return 1;
        }

        std::vector<char> payload(payload_size);
        std::cin.read(payload.data(), static_cast<std::streamsize>(payload_size));
        if (static_cast<size_t>(std::cin.gcount()) != payload_size) {
            std::fprintf(stderr, "truncated request payload\n");
            return 1;
        }
        if (payload_contains_nul(payload.data(), payload_size) ||
            payload_contains_escaped_nul(payload.data(), payload_size)) {
            if (!send_error(request_id, "request payload contains a NUL byte")) return 1;
            continue;
        }

        RequestPayload request;
        std::string payload_error;
        if (!parse_payload(payload.data(), payload_size, request, payload_error)) {
            if (!send_error(request_id, payload_error)) return 1;
            continue;
        }

        ls101_index_tts::DecodedWav reference;
        std::string decode_error;
        if (!ls101_index_tts::decode_wav(request.voice_path, reference, decode_error)) {
            if (!send_error(request_id, decode_error)) return 1;
            continue;
        }

        audiocpp_request * audiocpp_request = audiocpp_request_create();
        if (audiocpp_request == nullptr) {
            std::fprintf(stderr, "audiocpp_request_create failed\n");
            return 1;
        }
        audiocpp_status status = audiocpp_request_set_text(
            audiocpp_request, request.text.c_str(), request.language.c_str());
        if (status == AUDIOCPP_OK) {
            status = audiocpp_request_set_voice_audio(
                audiocpp_request,
                reference.samples.data(),
                reference.samples.size(),
                reference.sample_rate,
                1);
        }
        char number[32];
        if (status == AUDIOCPP_OK) {
            std::snprintf(number, sizeof(number), "%d", request.max_tokens);
            status = audiocpp_request_set_option(audiocpp_request, "max_tokens", number);
        }
        if (status == AUDIOCPP_OK && request.has_seed) {
            std::snprintf(number, sizeof(number), "%llu", static_cast<unsigned long long>(request.seed));
            status = audiocpp_request_set_option(audiocpp_request, "seed", number);
        }
        if (status == AUDIOCPP_OK && request.has_duration_factor) {
            std::snprintf(number, sizeof(number), "%.10g", request.duration_factor);
            status = audiocpp_request_set_option(audiocpp_request, "duration_factor", number);
        }
        if (status == AUDIOCPP_OK && request.has_temperature) {
            std::snprintf(number, sizeof(number), "%.10g", request.temperature);
            status = audiocpp_request_set_option(audiocpp_request, "temperature", number);
        }
        if (status == AUDIOCPP_OK && request.has_top_p) {
            std::snprintf(number, sizeof(number), "%.10g", request.top_p);
            status = audiocpp_request_set_option(audiocpp_request, "top_p", number);
        }
        if (status == AUDIOCPP_OK && request.has_top_k) {
            std::snprintf(number, sizeof(number), "%d", request.top_k);
            status = audiocpp_request_set_option(audiocpp_request, "top_k", number);
        }
        if (status != AUDIOCPP_OK) {
            audiocpp_request_free(audiocpp_request);
            if (!send_error(request_id, audiocpp_last_error())) return 1;
            continue;
        }

        audiocpp_result * result = nullptr;
        const audiocpp_status run_status =
            audiocpp_session_run(engine.session, audiocpp_request, &result);
        audiocpp_request_free(audiocpp_request);
        if (run_status != AUDIOCPP_OK) {
            const char * detail = audiocpp_last_error();
            const std::string message = detail && *detail ? detail : "speech synthesis failed";
            if (!send_error(request_id, message)) return 1;
            continue;
        }
        const float * samples = nullptr;
        size_t frames = 0;
        int sample_rate = 0;
        int channels = 0;
        const audiocpp_status audio_status =
            audiocpp_result_audio(result, &samples, &frames, &sample_rate, &channels);
        if (audio_status != AUDIOCPP_OK || samples == nullptr || frames == 0 || sample_rate <= 0 ||
            channels != 1) {
            audiocpp_result_free(result);
            const char * detail = audio_status != AUDIOCPP_OK ? audiocpp_last_error() : nullptr;
            const std::string message = detail && *detail ? detail : "synthesis produced no mono audio";
            if (!send_error(request_id, message)) return 1;
            continue;
        }
        const std::vector<float> mono(samples, samples + frames);
        audiocpp_result_free(result);
        const std::vector<uint8_t> wav =
            ls101_index_tts::encode_wav_pcm16(mono, sample_rate);
        if (wav.empty()) {
            if (!send_error(request_id, "generated audio exceeds the output size limit")) return 1;
            continue;
        }
        if (!send_result(request_id, wav, sample_rate)) {
            std::fprintf(stderr, "cannot write the RESULT frame\n");
            return 1;
        }
    }
    return 0;
}
