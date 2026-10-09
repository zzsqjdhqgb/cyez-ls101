#include "audiocpp.h"
#include "cJSON.h"
#include "audio.h"

#include <iostream>
#include <memory>
#include <set>
#include <sstream>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#include <shellapi.h>
#endif

namespace {
constexpr size_t max_header = 4096;
constexpr size_t max_payload = 512 * 1024;
constexpr size_t max_text = 64 * 1024;

void check(audiocpp_status status) {
    if (status != AUDIOCPP_OK) throw std::runtime_error(audiocpp_last_error());
}
template<class T, void (*Free)(T *)> using Handle = std::unique_ptr<T, decltype(Free)>;

uint64_t number(const std::string &text, uint64_t min, uint64_t max) {
    if (text.empty() || text.find_first_not_of("0123456789") != std::string::npos) throw std::runtime_error("Invalid integer");
    size_t end = 0;
    const auto value = std::stoull(text, &end);
    if (end != text.size() || value < min || value > max) throw std::runtime_error("Integer exceeds limits");
    return value;
}
bool header(std::string &line) {
    line.clear();
    char ch = 0;
    while (std::cin.get(ch)) {
        if (ch == '\n') {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            return true;
        }
        if (line.size() == max_header) throw std::runtime_error("Protocol header exceeds limits");
        line.push_back(ch);
    }
    if (!line.empty()) throw std::runtime_error("Truncated protocol header");
    return false;
}

std::string json_string(cJSON *root, const char *key) {
    const auto *value = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(value) || !value->valuestring || !*value->valuestring) throw std::runtime_error(std::string("Missing string: ") + key);
    return value->valuestring;
}
std::string json_integer(cJSON *root, const char *key, uint64_t min, uint64_t max) {
    const auto *value = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsNumber(value) || !std::isfinite(value->valuedouble) || std::floor(value->valuedouble) != value->valuedouble ||
        value->valuedouble < static_cast<double>(min) || value->valuedouble > static_cast<double>(max)) {
        throw std::runtime_error(std::string("Invalid integer: ") + key);
    }
    return std::to_string(static_cast<uint64_t>(value->valuedouble));
}

struct Runtime {
    Handle<audiocpp_registry, audiocpp_registry_free> registry{nullptr, audiocpp_registry_free};
    Handle<audiocpp_model, audiocpp_model_free> model{nullptr, audiocpp_model_free};
    Handle<audiocpp_session, audiocpp_session_free> session{nullptr, audiocpp_session_free};

    Runtime(const std::string &model_path, const std::string &backend, int device, int threads, bool low_memory) {
        const auto abi = audiocpp_abi_version();
        if ((abi >> 16) != AUDIOCPP_ABI_VERSION_MAJOR || (abi & 0xffff) < 0x0200) throw std::runtime_error("Unsupported audio.cpp ABI");
        audiocpp_registry *raw_registry = nullptr;
        check(audiocpp_registry_create(nullptr, &raw_registry)); registry.reset(raw_registry);
        audiocpp_model_config config{"index_tts2", nullptr, nullptr, nullptr};
        audiocpp_model *raw_model = nullptr;
        check(audiocpp_model_load(registry.get(), model_path.c_str(), &config, nullptr, &raw_model)); model.reset(raw_model);
        if (std::string(audiocpp_model_family(model.get())) != "index_tts2") throw std::runtime_error("Wrong model family");
        if (std::string(audiocpp_model_description(model.get())).find("IndexTTS2.5") == std::string::npos) throw std::runtime_error("IndexTTS 2.5 model is required");
        Handle<audiocpp_options, audiocpp_options_free> options{audiocpp_options_create(), audiocpp_options_free};
        if (!options) throw std::bad_alloc();
        check(audiocpp_options_set(options.get(), "index_tts2.mem_saver", low_memory ? "true" : "false"));
        for (const auto *key : {"index_tts2.speaker_cache_slots", "index_tts2.emotion_cache_slots", "index_tts2.emotion_text_cache_slots"}) {
            check(audiocpp_options_set(options.get(), key, "1"));
        }
        audiocpp_backend_config backend_config{backend.c_str(), device, threads};
        audiocpp_session *raw_session = nullptr;
        check(audiocpp_session_create(model.get(), "tts", "offline", &backend_config, options.get(), &raw_session)); session.reset(raw_session);
        check(audiocpp_session_prepare(session.get(), nullptr));
    }

    void synthesize(const std::string &id, const std::string &payload) {
        // Embedded NULs would truncate strings at the C ABI boundary.
        if (payload.find('\0') != std::string::npos || payload.find("\\u0000") != std::string::npos) throw std::runtime_error("Request contains NUL");
        Handle<cJSON, cJSON_Delete> json{cJSON_ParseWithLengthOpts(payload.c_str(), payload.size() + 1, nullptr, 1), cJSON_Delete};
        if (!json || !cJSON_IsObject(json.get())) throw std::runtime_error("Invalid request JSON");
        std::set<std::string> fields;
        for (auto *item = json->child; item; item = item->next) {
            if (!item->string || !fields.insert(item->string).second ||
                std::set<std::string>{"text", "voicePath", "language", "maxTokens", "seed"}.count(item->string) == 0) throw std::runtime_error("Unknown or duplicate request field");
        }
        const auto text = json_string(json.get(), "text");
        const auto voice_path = json_string(json.get(), "voicePath");
        const auto language = json_string(json.get(), "language");
        if (text.size() > max_text || voice_path.size() > 32768) throw std::runtime_error("Request string exceeds limits");
        if (std::set<std::string>{"auto", "zh", "en", "ja", "es", "ar"}.count(language) == 0) throw std::runtime_error("Unsupported language");
        const auto reference = index_tts::read_reference(voice_path);
        Handle<audiocpp_request, audiocpp_request_free> request{audiocpp_request_create(), audiocpp_request_free};
        if (!request) throw std::bad_alloc();
        check(audiocpp_request_set_text(request.get(), text.c_str(), language.c_str()));
        check(audiocpp_request_set_voice_audio(request.get(), reference.samples.data(), reference.samples.size() / static_cast<size_t>(reference.channels), reference.rate, reference.channels));
        check(audiocpp_request_set_option(request.get(), "max_tokens", json_integer(json.get(), "maxTokens", 1, 8192).c_str()));
        if (fields.count("seed")) check(audiocpp_request_set_option(request.get(), "seed", json_integer(json.get(), "seed", 0, 0xffffffff).c_str()));
        audiocpp_result *raw_result = nullptr;
        const auto status = audiocpp_session_run(session.get(), request.get(), &raw_result);
        Handle<audiocpp_result, audiocpp_result_free> result{raw_result, audiocpp_result_free};
        check(status);
        const float *samples = nullptr; size_t frames = 0; int rate = 0, channels = 0;
        check(audiocpp_result_audio(result.get(), &samples, &frames, &rate, &channels));
        const auto wav = index_tts::encode_wav(samples, frames, rate, channels);
        std::cout << "RESULT " << id << " " << rate << " " << wav.size() << '\n';
        std::cout.write(reinterpret_cast<const char *>(wav.data()), static_cast<std::streamsize>(wav.size()));
        std::cout.flush();
        if (!std::cout) throw std::runtime_error("Cannot write result");
    }
};
} // namespace

int main(int argc, char **argv) {
    try {
#ifdef _WIN32
        _setmode(_fileno(stdin), _O_BINARY); _setmode(_fileno(stdout), _O_BINARY);
        int wide_count = 0;
        auto **wide_args = CommandLineToArgvW(GetCommandLineW(), &wide_count);
        if (!wide_args) throw std::runtime_error("Cannot read Unicode arguments");
        std::vector<std::string> unicode_args;
        for (int i = 0; i < wide_count; ++i) {
            const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide_args[i], -1, nullptr, 0, nullptr, nullptr);
            if (size <= 0) { LocalFree(wide_args); throw std::runtime_error("Invalid Unicode argument"); }
            std::string text(static_cast<size_t>(size), '\0');
            WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide_args[i], -1, text.data(), size, nullptr, nullptr);
            text.pop_back(); unicode_args.push_back(std::move(text));
        }
        LocalFree(wide_args);
        std::vector<char *> utf8_args;
        for (auto &text : unicode_args) utf8_args.push_back(text.data());
        argc = wide_count; argv = utf8_args.data();
#endif
        std::string model_path, backend = "cuda";
        int device = 0, threads = 4;
        bool low_memory = true;
        std::set<std::string> seen;
        for (int i = 1; i < argc; i += 2) {
            if (i + 1 >= argc || !seen.insert(argv[i]).second) throw std::runtime_error("Invalid helper arguments");
            const std::string flag = argv[i], value = argv[i + 1];
            if (flag == "--model") model_path = value;
            else if (flag == "--backend" && (value == "cuda" || value == "cpu")) backend = value;
            else if (flag == "--device") device = static_cast<int>(number(value, 0, 31));
            else if (flag == "--threads") threads = static_cast<int>(number(value, 1, 256));
            else if (flag == "--low-memory") low_memory = number(value, 0, 1) != 0;
            else throw std::runtime_error("Unknown helper argument: " + flag);
        }
        if (model_path.empty() || !std::filesystem::u8path(model_path).is_absolute()) throw std::runtime_error("An absolute --model path is required");
        Runtime runtime(model_path, backend, device, threads, low_memory);
        std::cout << "READY 1\n" << std::flush;
        std::string line;
        while (header(line)) {
            std::istringstream input(line);
            std::string command, id, size, extra;
            if (!(input >> command >> id >> size) || (input >> extra) || command != "SYNTHESIZE" || id.empty() || id.size() > 64 || id.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != std::string::npos) throw std::runtime_error("Invalid request header");
            std::string payload(static_cast<size_t>(number(size, 1, max_payload)), '\0');
            if (!std::cin.read(payload.data(), static_cast<std::streamsize>(payload.size()))) throw std::runtime_error("Truncated request payload");
            try {
                runtime.synthesize(id, payload);
            } catch (const std::exception &error) {
                const std::string message = std::string(error.what()).substr(0, max_header);
                std::cerr << "IndexTTS request failed: " << message << '\n';
                std::cout << "ERROR " << id << " " << message.size() << '\n';
                std::cout.write(message.data(), static_cast<std::streamsize>(message.size()));
                std::cout.flush();
                if (!std::cout) throw std::runtime_error("Cannot write error");
            }
        }
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "IndexTTS helper: " << error.what() << '\n';
        return 1;
    }
}
