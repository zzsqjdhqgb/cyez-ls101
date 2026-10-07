// ls101-index-tts-helper — the IndexTTS 2.5 runtime helper for the Electron app.
//
// Frozen stdio contract (docs/engineering/index-tts.md):
//
//   argv  (load-time identity only, never voice or sampling parameters):
//     --backend <cpu|cuda> --model <gguf path>
//     --weight-type <native|f32|f16|bf16|q8_0> --language <auto|zh|en|ja|es|ar|...>
//     --threads <n>
//   stdin : one JSON header line
//           {"op":"synthesize","id":"…","textBytes":N,"voiceRef":"…", …}\n
//           followed by exactly N UTF-8 bytes.
//   stdout: {"type":"ready","version":1}\n once after the model is loaded, then per
//           request either
//             {"type":"result","requestId":"…","sampleRate":22050,"size":S}\n + S WAV bytes
//           or
//             {"type":"error","requestId":"…","size":M}\n + M UTF-8 message bytes.
//   stderr: diagnostics only.
//
// Layering (kept deliberately separate):
//   1. argv layer        — LoadOptions + parse_args(), load-time identity only.
//   2. protocol layer     — SynthRequest, the JSON header reader, frame writers,
//                           WAV encoding and the serve() loop.
//   3. engine layer       — the Engine interface and its two implementations:
//                           AudioCppEngine (audio.cpp C ABI) and StubEngine.
//
// LS101_INDEX_TTS_STUB_ENGINE replaces the audio.cpp engine with a synthetic tone
// generator so the protocol/argument layers compile and run without CUDA, audio.cpp
// or any model file:
//
//   g++ -O2 -std=c++17 -DLS101_INDEX_TTS_STUB_ENGINE -o helper native/index-tts/main.cpp
//
// The stub engine also honours the environment variables the Electron contract test
// uses: LS101_STUB_FAIL=<non-zero> answers every request with an error frame, and
// LS101_STUB_SECONDS=<f> sets the tone duration (default 0.2 s). Test-only knob, stub builds
// only: LS101_STUB_RATE=<n>[,<n>,...] overrides the sample rate the stub reports (one entry
// per request, the last entry repeats), so the protocol layer's engine-geometry validation
// can be exercised with a bogus or non-22050 rate. Never set it in production.

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

#ifndef LS101_INDEX_TTS_STUB_ENGINE
#include "audiocpp.h"  // the audio.cpp C ABI; absent in a stub-engine build
#endif

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

// ---------------------------------------------------------------------------
// Shared constants and request/load types
// ---------------------------------------------------------------------------

constexpr int kProtocolVersion = 1;
constexpr int kOutputSampleRate = 22050;  // the contract's fixed output rate
constexpr size_t kMaxTextBytes = 64 * 1024;
constexpr size_t kMaxErrorBytes = 4096;
// The request header is one LF-terminated line; the decoder's own header cap is 4096 B
// (MAX_HEADER_BYTES in index-tts-protocol.ts), so 64 KiB is far beyond anything legitimate.
// An over-long line is unrecoverable framing — see read_header_line().
constexpr size_t kMaxRequestHeaderBytes = 64 * 1024;
// The decoder rejects any `result` payload above MAX_PAYLOAD_BYTES = 100 * 1024 * 1024
// (index-tts-protocol.ts) and that limit covers the *whole* WAV file: the fixed 44-byte
// canonical header plus the data chunk. kMaxWavDataBytes is therefore the shared budget for
// the encoder and the resampler; kMaxPayloadBytes is only the name of the consumer's limit.
constexpr size_t kMaxPayloadBytes = 100 * 1024 * 1024;
constexpr size_t kWavHeaderBytes = 44;
constexpr size_t kMaxWavDataBytes = kMaxPayloadBytes - kWavHeaderBytes;  // 104857556
constexpr size_t kMaxOutputFrames = kMaxWavDataBytes / sizeof(int16_t);
constexpr size_t kMaxReferenceBytes = 64 * 1024 * 1024;
// Sane geometry for raw engine output: at most 10 minutes at the highest accepted rate and
// channel count. Anything larger is a corrupt count, not audio.
constexpr int kMinEngineSampleRate = 8000;
constexpr int kMaxEngineSampleRate = 192000;
constexpr int kMaxEngineChannels = 8;
constexpr size_t kMaxEngineFrames = static_cast<size_t>(kMaxEngineSampleRate) * 600;
constexpr size_t kMaxEngineSamples =
    kMaxEngineFrames * static_cast<size_t>(kMaxEngineChannels);

// Documented defaults; a field that is absent or out of range falls back to these.
constexpr double kDefaultEmotionAlpha = 1.0;
constexpr double kDefaultDurationFactor = 1.0;
constexpr int kDefaultNumBeams = 3;
constexpr bool kDefaultDoSample = true;
constexpr double kDefaultTemperature = 0.8;
constexpr int kDefaultTopK = 30;
constexpr double kDefaultTopP = 0.8;
constexpr double kDefaultRepetitionPenalty = 10.0;
constexpr int kDefaultMaxMelTokens = 1500;

// One synthesis request: the header fields plus the text payload that follows it.
struct SynthRequest {
  std::string id;
  size_t text_bytes = 0;
  std::string text;
  std::string voice_ref;
  double emotion_alpha = kDefaultEmotionAlpha;
  double duration_factor = kDefaultDurationFactor;
  int num_beams = kDefaultNumBeams;
  bool do_sample = kDefaultDoSample;
  double temperature = kDefaultTemperature;
  int top_k = kDefaultTopK;
  double top_p = kDefaultTopP;
  double repetition_penalty = kDefaultRepetitionPenalty;
  int max_mel_tokens = kDefaultMaxMelTokens;
};

// Load-time identity. Everything that changes between requests stays out of argv:
// the process is reused across voices, and CPU thread count changes clone results.
struct LoadOptions {
  std::string backend;      // "cpu" | "cuda"
  std::string model_path;
  std::string weight_type;  // "native" | "f32" | "f16" | "bf16" | "q8_0"
  std::string language;     // "auto" | "zh" | "en" | "ja" | "es" | "ar" | ...
  int threads = 4;
};

// ---------------------------------------------------------------------------
// JSON header reader (protocol layer)
// ---------------------------------------------------------------------------

struct JsonValue {
  enum class Kind { Null, Boolean, Number, String, Other };
  Kind kind = Kind::Null;
  bool boolean = false;
  double number = 0.0;
  std::string string;
};

// Flat JSON object parser for the request header. It accepts exactly what
// JSON.stringify produces on the Electron side, rejects anything malformed, and
// keeps only the top-level fields (nested values are validated and skipped).
class JsonHeader {
 public:
  bool parse(const std::string& text, std::string& error) {
    cursor_ = text.c_str();
    end_ = cursor_ + text.size();
    skip_whitespace();
    if (!consume('{')) {
      error = "请求头必须是 JSON 对象";
      return false;
    }
    skip_whitespace();
    if (consume('}')) return require_end(error);
    for (;;) {
      skip_whitespace();
      std::string key;
      if (!parse_string(key, error)) return false;
      skip_whitespace();
      if (!consume(':')) {
        error = "JSON 对象缺少冒号";
        return false;
      }
      skip_whitespace();
      JsonValue value;
      if (!parse_value(value, 0, error)) return false;
      fields_[key] = std::move(value);
      skip_whitespace();
      if (consume(',')) continue;
      if (consume('}')) return require_end(error);
      error = "JSON 对象格式错误";
      return false;
    }
  }

  const JsonValue* find(const std::string& key) const {
    const auto entry = fields_.find(key);
    return entry == fields_.end() ? nullptr : &entry->second;
  }

  bool string_field(const std::string& key, std::string& output) const {
    const JsonValue* value = find(key);
    if (!value || value->kind != JsonValue::Kind::String) return false;
    output = value->string;
    return true;
  }

  // True only for a finite JSON number; the caller applies its own range check.
  bool number_field(const std::string& key, double& output) const {
    const JsonValue* value = find(key);
    if (!value || value->kind != JsonValue::Kind::Number) return false;
    output = value->number;
    return true;
  }

  bool bool_field(const std::string& key, bool& output) const {
    const JsonValue* value = find(key);
    if (!value || value->kind != JsonValue::Kind::Boolean) return false;
    output = value->boolean;
    return true;
  }

 private:
  bool parse_value(JsonValue& value, int depth, std::string& error) {
    if (depth > 16) {
      error = "JSON 嵌套过深";
      return false;
    }
    if (cursor_ >= end_) {
      error = "JSON 值不完整";
      return false;
    }
    switch (*cursor_) {
      case '"':
        value.kind = JsonValue::Kind::String;
        return parse_string(value.string, error);
      case '{':
      case '[': {
        value.kind = JsonValue::Kind::Other;
        int levels = 0;
        while (cursor_ < end_) {
          const char character = *cursor_++;
          if (character == '"') {
            --cursor_;
            std::string ignored;
            if (!parse_string(ignored, error)) return false;
            continue;
          }
          if (character == '{' || character == '[') {
            ++levels;
            if (levels > 16) {
              error = "JSON 嵌套过深";
              return false;
            }
          } else if (character == '}' || character == ']') {
            if (--levels == 0) return true;
          }
        }
        error = "JSON 结构不完整";
        return false;
      }
      case 't':
        if (!consume_literal("true")) {
          error = "JSON 字面量无效";
          return false;
        }
        value.kind = JsonValue::Kind::Boolean;
        value.boolean = true;
        return true;
      case 'f':
        if (!consume_literal("false")) {
          error = "JSON 字面量无效";
          return false;
        }
        value.kind = JsonValue::Kind::Boolean;
        value.boolean = false;
        return true;
      case 'n':
        if (!consume_literal("null")) {
          error = "JSON 字面量无效";
          return false;
        }
        value.kind = JsonValue::Kind::Null;
        return true;
      default: {
        char* stop = nullptr;
        const double parsed = std::strtod(cursor_, &stop);
        if (stop == cursor_ || !std::isfinite(parsed)) {
          error = "JSON 数字无效";
          return false;
        }
        cursor_ = stop;
        value.kind = JsonValue::Kind::Number;
        value.number = parsed;
        return true;
      }
    }
  }

  bool parse_string(std::string& output, std::string& error) {
    output.clear();
    if (!consume('"')) {
      error = "JSON 字符串缺少引号";
      return false;
    }
    while (cursor_ < end_) {
      const unsigned char character = static_cast<unsigned char>(*cursor_++);
      if (character == '"') return true;
      if (character == '\\') {
        if (cursor_ >= end_) break;
        const char escape = *cursor_++;
        switch (escape) {
          case '"': output.push_back('"'); break;
          case '\\': output.push_back('\\'); break;
          case '/': output.push_back('/'); break;
          case 'b': output.push_back('\b'); break;
          case 'f': output.push_back('\f'); break;
          case 'n': output.push_back('\n'); break;
          case 'r': output.push_back('\r'); break;
          case 't': output.push_back('\t'); break;
          case 'u': {
            uint32_t code = 0;
            if (!parse_hex4(code, error)) return false;
            if (code >= 0xd800 && code <= 0xdbff) {
              // A high surrogate only means something with its low half.
              if (end_ - cursor_ >= 6 && cursor_[0] == '\\' && cursor_[1] == 'u') {
                cursor_ += 2;
                uint32_t low = 0;
                if (!parse_hex4(low, error)) return false;
                if (low >= 0xdc00 && low <= 0xdfff) {
                  code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                } else {
                  append_utf8(output, 0xfffd);
                  code = low;
                }
              } else {
                code = 0xfffd;
              }
            } else if (code >= 0xdc00 && code <= 0xdfff) {
              code = 0xfffd;  // lone low surrogate
            }
            append_utf8(output, code);
            break;
          }
          default:
            error = "JSON 字符串包含无效转义";
            return false;
        }
        continue;
      }
      if (character < 0x20) {
        error = "JSON 字符串包含控制字符";
        return false;
      }
      output.push_back(static_cast<char>(character));
    }
    error = "JSON 字符串未闭合";
    return false;
  }

  bool parse_hex4(uint32_t& output, std::string& error) {
    if (end_ - cursor_ < 4) {
      error = "JSON Unicode 转义不完整";
      return false;
    }
    uint32_t value = 0;
    for (int index = 0; index < 4; ++index) {
      const char digit = cursor_[index];
      value <<= 4;
      if (digit >= '0' && digit <= '9') value |= static_cast<uint32_t>(digit - '0');
      else if (digit >= 'a' && digit <= 'f') value |= static_cast<uint32_t>(digit - 'a' + 10);
      else if (digit >= 'A' && digit <= 'F') value |= static_cast<uint32_t>(digit - 'A' + 10);
      else {
        error = "JSON Unicode 转义无效";
        return false;
      }
    }
    cursor_ += 4;
    output = value;
    return true;
  }

  static void append_utf8(std::string& output, uint32_t code) {
    if (code <= 0x7f) {
      output.push_back(static_cast<char>(code));
    } else if (code <= 0x7ff) {
      output.push_back(static_cast<char>(0xc0 | (code >> 6)));
      output.push_back(static_cast<char>(0x80 | (code & 0x3f)));
    } else if (code <= 0xffff) {
      output.push_back(static_cast<char>(0xe0 | (code >> 12)));
      output.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3f)));
      output.push_back(static_cast<char>(0x80 | (code & 0x3f)));
    } else {
      output.push_back(static_cast<char>(0xf0 | (code >> 18)));
      output.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3f)));
      output.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3f)));
      output.push_back(static_cast<char>(0x80 | (code & 0x3f)));
    }
  }

  bool consume(char expected) {
    if (cursor_ < end_ && *cursor_ == expected) {
      ++cursor_;
      return true;
    }
    return false;
  }

  bool consume_literal(const char* literal) {
    const size_t length = std::strlen(literal);
    if (static_cast<size_t>(end_ - cursor_) < length) return false;
    if (std::memcmp(cursor_, literal, length) != 0) return false;
    cursor_ += length;
    return true;
  }

  void skip_whitespace() {
    while (cursor_ < end_ && (*cursor_ == ' ' || *cursor_ == '\t' || *cursor_ == '\r' ||
                              *cursor_ == '\n')) {
      ++cursor_;
    }
  }

  bool require_end(std::string& error) {
    skip_whitespace();
    if (cursor_ != end_) {
      error = "请求头包含多余内容";
      return false;
    }
    return true;
  }

  std::map<std::string, JsonValue> fields_;
  const char* cursor_ = nullptr;
  const char* end_ = nullptr;
};

std::string json_escape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size() + 8);
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

// Caps an error payload at the decoder's 4096-byte limit without splitting a
// multi-byte UTF-8 sequence.
std::string truncate_utf8(const std::string& value, size_t max_bytes) {
  if (value.size() <= max_bytes) return value;
  size_t end = max_bytes;
  while (end > 0 && (static_cast<unsigned char>(value[end]) & 0xc0) == 0x80) --end;
  return value.substr(0, end);
}

double clamp_or(double value, double fallback, double minimum, double maximum) {
  return std::isfinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

int integer_or(double value, int fallback, int minimum, int maximum) {
  if (!std::isfinite(value)) return fallback;
  const double rounded = std::floor(value);
  if (rounded != value || rounded < minimum || rounded > maximum) return fallback;
  return static_cast<int>(rounded);
}

bool valid_request_id(const std::string& value) {
  if (value.empty() || value.size() > 64) return false;
  return std::all_of(value.begin(), value.end(), [](unsigned char character) {
    return std::isalnum(character) != 0 || character == '-' || character == '_';
  });
}

bool parse_request_header(const std::string& line, SynthRequest& request, std::string& error) {
  JsonHeader header;
  if (!header.parse(line, error)) return false;

  std::string op;
  if (!header.string_field("op", op) || op != "synthesize") {
    error = "不支持的 op（需要 synthesize）";
    return false;
  }
  if (!header.string_field("id", request.id) || !valid_request_id(request.id)) {
    error = "请求 id 缺失或非法";
    return false;
  }
  double text_bytes = 0.0;
  if (!header.number_field("textBytes", text_bytes) || std::floor(text_bytes) != text_bytes ||
      text_bytes < 0 || text_bytes > static_cast<double>(kMaxTextBytes)) {
    error = "textBytes 缺失或超出 0..65536";
    return false;
  }
  request.text_bytes = static_cast<size_t>(text_bytes);
  if (!header.string_field("voiceRef", request.voice_ref)) request.voice_ref.clear();

  double number = 0.0;
  if (header.number_field("emotionAlpha", number)) {
    request.emotion_alpha = clamp_or(number, kDefaultEmotionAlpha, 0.0, 1.0);
  }
  if (header.number_field("durationFactor", number)) {
    request.duration_factor = clamp_or(number, kDefaultDurationFactor, 0.001, 100.0);
  }
  if (header.number_field("numBeams", number)) {
    request.num_beams = integer_or(number, kDefaultNumBeams, 1, 16);
  }
  bool flag = false;
  if (header.bool_field("doSample", flag)) request.do_sample = flag;
  if (header.number_field("temperature", number)) {
    request.temperature = clamp_or(number, kDefaultTemperature, 0.0, 5.0);
  }
  if (header.number_field("topK", number)) {
    request.top_k = integer_or(number, kDefaultTopK, 0, 2048);
  }
  if (header.number_field("topP", number)) {
    request.top_p = clamp_or(number, kDefaultTopP, 0.0, 1.0);
  }
  if (header.number_field("repetitionPenalty", number)) {
    request.repetition_penalty = clamp_or(number, kDefaultRepetitionPenalty, 0.1, 10.0);
  }
  if (header.number_field("maxMelTokens", number)) {
    request.max_mel_tokens = integer_or(number, kDefaultMaxMelTokens, 1, 8192);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Output formatting (protocol layer): mono 22050 Hz PCM16 WAV + frame writers
// ---------------------------------------------------------------------------

// Validates the channel count the engine reported. Kept separate so callers can divide by it
// only after it is known to be sane.
bool validate_engine_channels(int channels, std::string& error) {
  if (channels < 1 || channels > kMaxEngineChannels) {
    error = "引擎返回的声道数非法：" + std::to_string(channels) + "（需在 1..8 之间）";
    return false;
  }
  return true;
}

// Validates the engine's frame count, sample rate and channel count *before* any buffer is
// sized from them, and bounds `frames * channels` without overflowing.
//
// `frames` is `size_t` in the audio.cpp C ABI (audiocpp_result_audio), so a negative count is
// unrepresentable; a corrupt count shows up as zero or as an absurdly large value, both of
// which are rejected here.
bool validate_engine_audio(size_t frames, int sample_rate, int channels, std::string& error) {
  if (!validate_engine_channels(channels, error)) return false;
  if (sample_rate < kMinEngineSampleRate || sample_rate > kMaxEngineSampleRate) {
    error = "引擎返回的采样率非法：" + std::to_string(sample_rate) +
            " Hz（需在 8000..192000 之间）";
    return false;
  }
  if (frames == 0) {
    error = "引擎未返回音频";
    return false;
  }
  if (frames > kMaxEngineFrames ||
      frames > kMaxEngineSamples / static_cast<size_t>(channels)) {
    error = "引擎返回的采样帧数超出限制：" + std::to_string(frames);
    return false;
  }
  return true;
}

std::vector<float> to_mono(const std::vector<float>& samples, int channels) {
  if (channels <= 1) return samples;
  const size_t frame_count = samples.size() / static_cast<size_t>(channels);
  std::vector<float> mono(frame_count, 0.0f);
  for (size_t frame = 0; frame < frame_count; ++frame) {
    float sum = 0.0f;
    for (int channel = 0; channel < channels; ++channel) {
      sum += samples[frame * static_cast<size_t>(channels) + static_cast<size_t>(channel)];
    }
    mono[frame] = sum / static_cast<float>(channels);
  }
  return mono;
}

// Resamples mono float audio from the engine's native rate to the contract rate.
//
// `input_rate` is validated before this is reached, but it is checked again here so the
// function is safe on its own: a bogus rate must fail the request rather than pass the input
// through while the result frame still declares 22050 Hz (wrong-speed audio).
//
// The expected output frame count is computed in integer arithmetic (the exact floor of
// input_frames * output_rate / input_rate) and refused when it would not fit the encoder's
// payload budget, so the allocation below is always bounded and can never overflow.
bool resample_linear(const std::vector<float>& input, int input_rate, int output_rate,
                     std::vector<float>& output, std::string& error) {
  if (input.empty()) {
    output.clear();
    return true;
  }
  if (input_rate < kMinEngineSampleRate || input_rate > kMaxEngineSampleRate) {
    error = "引擎返回的采样率非法：" + std::to_string(input_rate) +
            " Hz（需在 8000..192000 之间）";
    return false;
  }
  if (input_rate == output_rate) {
    output = input;  // byte-identical passthrough: the common 22050 Hz case
    return true;
  }
  if (output_rate <= 0 ||
      input.size() > std::numeric_limits<uint64_t>::max() / static_cast<uint64_t>(output_rate)) {
    error = "重采样输入过大，无法计算输出帧数";
    return false;
  }
  const uint64_t output_frames = static_cast<uint64_t>(input.size()) *
                                 static_cast<uint64_t>(output_rate) /
                                 static_cast<uint64_t>(input_rate);
  if (output_frames > static_cast<uint64_t>(kMaxOutputFrames)) {
    error = "重采样后的音频超过输出大小限制";
    return false;
  }
  if (output_frames == 0) {
    error = "重采样后的音频为空";
    return false;
  }

  const double ratio = static_cast<double>(input_rate) / static_cast<double>(output_rate);
  output.assign(static_cast<size_t>(output_frames), 0.0f);
  for (size_t index = 0; index < output.size(); ++index) {
    const double position = static_cast<double>(index) * ratio;
    const size_t left = std::min(static_cast<size_t>(position), input.size() - 1);
    const size_t right = std::min(left + 1, input.size() - 1);
    const double fraction = position - static_cast<double>(left);
    output[index] =
        static_cast<float>((1.0 - fraction) * input[left] + fraction * input[right]);
  }
  return true;
}

void append_u16(std::vector<uint8_t>& output, uint16_t value) {
  output.push_back(static_cast<uint8_t>(value & 0xff));
  output.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
}

void append_u32(std::vector<uint8_t>& output, uint32_t value) {
  output.push_back(static_cast<uint8_t>(value & 0xff));
  output.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
  output.push_back(static_cast<uint8_t>((value >> 16) & 0xff));
  output.push_back(static_cast<uint8_t>((value >> 24) & 0xff));
}

std::vector<uint8_t> encode_wav(const std::vector<float>& samples, int sample_rate) {
  // The whole RIFF/WAVE file — 44-byte canonical header plus data — must stay within
  // MAX_PAYLOAD_BYTES (100 MiB, index-tts-protocol.ts), so `data` gets what is left over.
  if (samples.size() > kMaxWavDataBytes / sizeof(int16_t)) return {};
  const uint64_t data_size_64 = static_cast<uint64_t>(samples.size()) * sizeof(int16_t);
  if (data_size_64 > kMaxWavDataBytes ||
      data_size_64 > static_cast<uint64_t>(std::numeric_limits<uint32_t>::max() -
                                           (kWavHeaderBytes - 8))) {
    return {};
  }
  const uint32_t data_size = static_cast<uint32_t>(data_size_64);
  std::vector<uint8_t> output;
  output.reserve(kWavHeaderBytes + data_size);
  const auto append_text = [&output](const char* value) {
    output.insert(output.end(), value, value + 4);
  };
  append_text("RIFF");
  append_u32(output, static_cast<uint32_t>(kWavHeaderBytes - 8 + data_size));
  append_text("WAVE");
  append_text("fmt ");
  append_u32(output, 16);
  append_u16(output, 1);  // PCM
  append_u16(output, 1);  // mono
  append_u32(output, static_cast<uint32_t>(sample_rate));
  append_u32(output, static_cast<uint32_t>(sample_rate * 2));
  append_u16(output, 2);   // block align
  append_u16(output, 16);  // bits per sample
  append_text("data");
  append_u32(output, data_size);
  for (const float sample : samples) {
    const float finite = std::isfinite(sample) ? sample : 0.0f;
    const float clamped = std::max(-1.0f, std::min(1.0f, finite));
    const int16_t pcm = static_cast<int16_t>(std::lrint(clamped * 32767.0f));
    append_u16(output, static_cast<uint16_t>(pcm));
  }
  return output;
}

void write_raw(const void* data, size_t bytes) {
  if (bytes == 0) return;
  std::cout.write(static_cast<const char*>(data), static_cast<std::streamsize>(bytes));
}

void send_ready() {
  static const char kReady[] = "{\"type\":\"ready\",\"version\":1}\n";
  write_raw(kReady, sizeof(kReady) - 1);
  std::cout.flush();
}

void send_result(const std::string& request_id, const std::vector<uint8_t>& wav) {
  const std::string header = "{\"type\":\"result\",\"requestId\":\"" + json_escape(request_id) +
                             "\",\"sampleRate\":" + std::to_string(kOutputSampleRate) +
                             ",\"size\":" + std::to_string(wav.size()) + "}\n";
  write_raw(header.data(), header.size());
  write_raw(wav.data(), wav.size());
  std::cout.flush();
}

void send_error(const std::string& request_id, const std::string& message) {
  const std::string payload = truncate_utf8(message, kMaxErrorBytes);
  const std::string header = "{\"type\":\"error\",\"requestId\":\"" + json_escape(request_id) +
                             "\",\"size\":" + std::to_string(payload.size()) + "}\n";
  write_raw(header.data(), header.size());
  write_raw(payload.data(), payload.size());
  std::cout.flush();
}

// ---------------------------------------------------------------------------
// Engine layer
// ---------------------------------------------------------------------------

class Engine {
 public:
  virtual ~Engine() = default;
  virtual bool load(const LoadOptions& options, std::string& error) = 0;
  // On success fills interleaved samples plus their native rate/channel count;
  // the protocol layer converts that to the contract's mono 22050 Hz PCM16 WAV.
  virtual bool synthesize(const SynthRequest& request, std::vector<float>& samples,
                          int& sample_rate, int& channels, std::string& error) = 0;
};

#ifndef LS101_INDEX_TTS_STUB_ENGINE

// ---- audio.cpp C ABI engine -------------------------------------------------

template <typename Handle, void (*Release)(Handle*)>
class HandleGuard {
 public:
  HandleGuard() = default;
  HandleGuard(const HandleGuard&) = delete;
  HandleGuard& operator=(const HandleGuard&) = delete;
  ~HandleGuard() { reset(); }

  Handle** receive() { return &value_; }
  Handle* get() const { return value_; }
  explicit operator bool() const { return value_ != nullptr; }

  void reset(Handle* replacement = nullptr) {
    if (value_) Release(value_);
    value_ = replacement;
  }

 private:
  Handle* value_ = nullptr;
};

std::string describe_status(const char* call, audiocpp_status status) {
  std::string message =
      std::string(call) + " 失败（" + audiocpp_status_string(status) + "）";
  const char* detail = audiocpp_last_error();
  if (detail && *detail) {
    message += "：";
    message += detail;
  }
  return message;
}

// Decodes a mono reference WAV into float samples. Only the reference clip needs
// this: the engine receives audio as floats through the C ABI.
bool decode_wav(const std::vector<uint8_t>& bytes, std::vector<float>& samples,
                int& sample_rate, int& channels, std::string& error) {
  const auto read_u16 = [&bytes](size_t offset) {
    return static_cast<uint16_t>(bytes[offset] | (bytes[offset + 1] << 8));
  };
  const auto read_u32 = [&bytes](size_t offset) {
    return static_cast<uint32_t>(bytes[offset]) |
           (static_cast<uint32_t>(bytes[offset + 1]) << 8) |
           (static_cast<uint32_t>(bytes[offset + 2]) << 16) |
           (static_cast<uint32_t>(bytes[offset + 3]) << 24);
  };
  if (bytes.size() < 44 || std::memcmp(bytes.data(), "RIFF", 4) != 0 ||
      std::memcmp(bytes.data() + 8, "WAVE", 4) != 0) {
    error = "不是有效的 RIFF/WAVE 文件";
    return false;
  }

  bool have_format = false;
  uint16_t format = 0;
  uint16_t bits = 0;
  int rate = 0;
  int channel_count = 0;
  size_t data_offset = 0;
  size_t data_size = 0;

  size_t position = 12;
  while (position + 8 <= bytes.size()) {
    const char* id = reinterpret_cast<const char*>(bytes.data() + position);
    size_t chunk_size = read_u32(position + 4);
    const size_t body = position + 8;
    const size_t available = bytes.size() - body;
    if (chunk_size > available) chunk_size = available;  // tolerate a truncated tail

    if (std::memcmp(id, "fmt ", 4) == 0 && chunk_size >= 16) {
      format = read_u16(body);
      channel_count = read_u16(body + 2);
      rate = static_cast<int>(read_u32(body + 4));
      bits = read_u16(body + 14);
      if (format == 0xfffe && chunk_size >= 40) format = read_u16(body + 24);
      have_format = true;
    } else if (std::memcmp(id, "data", 4) == 0) {
      data_offset = body;
      data_size = chunk_size;
    }
    position = body + chunk_size + (chunk_size & 1u);
  }

  if (!have_format) {
    error = "WAV 缺少 fmt 块";
    return false;
  }
  if (data_size == 0) {
    error = "WAV 缺少 data 块";
    return false;
  }
  if (rate < 8000 || rate > 192000) {
    error = "WAV 采样率必须在 8000..192000 Hz 之间";
    return false;
  }
  if (channel_count < 1 || channel_count > 8) {
    error = "WAV 声道数必须在 1..8 之间";
    return false;
  }
  const bool is_float = format == 3;
  const bool is_pcm = format == 1;
  const int bytes_per_sample = bits / 8;
  if ((!is_pcm && !is_float) || bytes_per_sample < 1 || bytes_per_sample > 8 ||
      (is_pcm && bits != 8 && bits != 16 && bits != 24 && bits != 32) ||
      (is_float && bits != 32 && bits != 64)) {
    error = "WAV 位深或编码格式不受支持";
    return false;
  }

  const size_t frame_bytes = static_cast<size_t>(bytes_per_sample) *
                             static_cast<size_t>(channel_count);
  const size_t frame_count = data_size / frame_bytes;
  if (frame_count == 0) {
    error = "WAV 不包含采样数据";
    return false;
  }

  samples.assign(frame_count, 0.0f);
  for (size_t frame = 0; frame < frame_count; ++frame) {
    double sum = 0.0;
    for (int channel = 0; channel < channel_count; ++channel) {
      const size_t offset = data_offset + frame * frame_bytes +
                            static_cast<size_t>(channel) * static_cast<size_t>(bytes_per_sample);
      double value = 0.0;
      if (is_float) {
        if (bits == 32) {
          float stored = 0.0f;
          std::memcpy(&stored, bytes.data() + offset, sizeof(stored));
          value = stored;
        } else {
          double stored = 0.0;
          std::memcpy(&stored, bytes.data() + offset, sizeof(stored));
          value = stored;
        }
      } else if (bits == 8) {
        value = (static_cast<double>(bytes[offset]) - 128.0) / 128.0;
      } else if (bits == 16) {
        const int16_t stored = static_cast<int16_t>(read_u16(offset));
        value = static_cast<double>(stored) / 32768.0;
      } else if (bits == 24) {
        int32_t stored = static_cast<int32_t>(bytes[offset]) |
                         (static_cast<int32_t>(bytes[offset + 1]) << 8) |
                         (static_cast<int32_t>(bytes[offset + 2]) << 16);
        if (stored & 0x00800000) stored |= ~0x00ffffff;  // sign extend
        value = static_cast<double>(stored) / 8388608.0;
      } else {
        const int32_t stored = static_cast<int32_t>(read_u32(offset));
        value = static_cast<double>(stored) / 2147483648.0;
      }
      sum += value;
    }
    samples[frame] = static_cast<float>(sum / static_cast<double>(channel_count));
  }
  sample_rate = rate;
  channels = 1;
  return true;
}

class AudioCppEngine final : public Engine {
 public:
  ~AudioCppEngine() override { close(); }

  bool load(const LoadOptions& options, std::string& error) override {
    close();
    const uint32_t abi = audiocpp_abi_version();
    if ((abi >> 16) != AUDIOCPP_ABI_VERSION_MAJOR) {
      error = "audio.cpp ABI 主版本不兼容：" + std::to_string(abi >> 16) + " != " +
              std::to_string(AUDIOCPP_ABI_VERSION_MAJOR);
      return false;
    }

    audiocpp_status status = audiocpp_registry_create(nullptr, registry_.receive());
    if (status != AUDIOCPP_OK) {
      error = describe_status("audiocpp_registry_create", status);
      return false;
    }

    audiocpp_model_config config{};
    config.family_hint = "index_tts2";
    status = audiocpp_model_load(registry_.get(), options.model_path.c_str(), &config, nullptr,
                                 model_.receive());
    if (status != AUDIOCPP_OK) {
      error = describe_status("audiocpp_model_load", status);
      return false;
    }

    // Runtime introspection, diagnostics only: never fail a load over it.
    const char* family = audiocpp_model_family(model_.get());
    const char* description = audiocpp_model_description(model_.get());
    std::fprintf(stderr, "[index-tts] loaded family=%s description=%s\n",
                 family && *family ? family : "?", description && *description ? description : "?");
    if (!audiocpp_model_supports(model_.get(), "clon", "offline")) {
      std::fprintf(stderr,
                   "[index-tts] warning: the loaded model does not advertise clon/offline\n");
    }

    audiocpp_options* session_options = audiocpp_options_create();
    if (!session_options) {
      error = "audiocpp_options_create 失败";
      return false;
    }
    session_options_.reset(session_options);
    // index_tts2.weight_type is a session option. "native" is the documented
    // default for "not set", so it is left unset rather than written explicitly.
    if (options.weight_type != "native") {
      status = audiocpp_options_set(session_options_.get(), "index_tts2.weight_type",
                                    options.weight_type.c_str());
      if (status != AUDIOCPP_OK) {
        error = describe_status("audiocpp_options_set(index_tts2.weight_type)", status);
        return false;
      }
    }

    audiocpp_backend_config backend{};
    backend.backend = options.backend.c_str();
    backend.device = 0;
    backend.threads = options.threads;  // pinned: thread count changes clone results
    status = audiocpp_session_create(model_.get(), "clon", "offline", &backend,
                                     session_options_.get(), session_.receive());
    if (status != AUDIOCPP_OK) {
      error = describe_status("audiocpp_session_create", status);
      return false;
    }
    language_ = options.language;
    loaded_ = true;
    return true;
  }

  bool synthesize(const SynthRequest& request, std::vector<float>& samples, int& sample_rate,
                  int& channels, std::string& error) override {
    if (!loaded_) {
      error = "引擎尚未加载模型";
      return false;
    }
    const std::vector<float>* reference = nullptr;
    size_t reference_frames = 0;
    int reference_rate = 0;
    if (!resolve_reference(request.voice_ref, reference, reference_frames, reference_rate,
                           error)) {
      return false;
    }

    HandleGuard<audiocpp_request, audiocpp_request_free> handle;
    audiocpp_request* c_request = audiocpp_request_create();
    if (!c_request) {
      error = "audiocpp_request_create 失败";
      return false;
    }
    handle.reset(c_request);

    audiocpp_status status = audiocpp_request_set_text(
        c_request, request.text.c_str(), language_.empty() ? nullptr : language_.c_str());
    if (status != AUDIOCPP_OK) {
      error = describe_status("audiocpp_request_set_text", status);
      return false;
    }

    // Every synthesis parameter travels per request; a change here must never
    // require a reload, so all of them ride on the request option map.
    const std::pair<const char*, std::string> options[] = {
        {"emotion_alpha", format_number(request.emotion_alpha)},
        {"duration_factor", format_number(request.duration_factor)},
        {"num_beams", std::to_string(request.num_beams)},
        {"do_sample", request.do_sample ? "true" : "false"},
        {"temperature", format_number(request.temperature)},
        {"top_k", std::to_string(request.top_k)},
        {"top_p", format_number(request.top_p)},
        {"repetition_penalty", format_number(request.repetition_penalty)},
        {"max_tokens", std::to_string(request.max_mel_tokens)},
    };
    for (const auto& option : options) {
      status = audiocpp_request_set_option(c_request, option.first, option.second.c_str());
      if (status != AUDIOCPP_OK) {
        error = describe_status("audiocpp_request_set_option", status);
        return false;
      }
    }

    status = audiocpp_request_set_voice_audio(c_request, reference->data(), reference_frames,
                                              reference_rate, 1);
    if (status != AUDIOCPP_OK) {
      error = describe_status("audiocpp_request_set_voice_audio", status);
      return false;
    }

    HandleGuard<audiocpp_result, audiocpp_result_free> result;
    status = audiocpp_session_run(session_.get(), c_request, result.receive());
    if (status != AUDIOCPP_OK) {
      error = describe_status("audiocpp_session_run", status);
      return false;
    }

    const float* output = nullptr;
    size_t frames = 0;
    int rate = 0;
    int channel_count = 1;
    status = audiocpp_result_audio(result.get(), &output, &frames, &rate, &channel_count);
    if (status != AUDIOCPP_OK) {
      error = describe_status("audiocpp_result_audio", status);
      return false;
    }
    if (!output) {
      error = "audio.cpp 未返回音频";
      return false;
    }
    // Bound the engine's geometry before sizing the copy below: `frames * channel_count` is
    // computed only after both factors passed validation, so the assign cannot overflow and
    // the allocation cannot be driven past kMaxEngineSamples by a corrupt count.
    if (!validate_engine_audio(frames, rate, channel_count, error)) return false;
    samples.assign(output, output + frames * static_cast<size_t>(channel_count));
    sample_rate = rate;
    channels = channel_count;
    return true;
  }

 private:
  static std::string format_number(double value) {
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%.6g", value);
    return buffer;
  }

  // The reference clip is decoded once per distinct voiceRef. The key carries the
  // file size and write time, so replacing a file at the same path invalidates the
  // cache instead of reusing stale audio. The engine's own speaker cache
  // (index_tts2.speaker_cache_slots, default 1) avoids re-encoding it per request.
  bool resolve_reference(const std::string& path, const std::vector<float>*& samples,
                         size_t& frames, int& sample_rate, std::string& error) {
    if (path.empty()) {
      error = "请求缺少 voiceRef（音色参考音频路径）";
      return false;
    }
    std::error_code code;
    const std::uintmax_t size = std::filesystem::file_size(path, code);
    if (code) {
      error = "音色参考音频不可用：" + path;
      return false;
    }
    if (size == 0 || size > kMaxReferenceBytes) {
      error = "音色参考音频大小超出限制：" + path;
      return false;
    }
    const auto write_time = std::filesystem::last_write_time(path, code);
    const std::string key =
        path + "|" + std::to_string(size) + "|" +
        (code ? std::string("?") : std::to_string(write_time.time_since_epoch().count()));
    if (key != reference_key_) {
      std::ifstream input(path, std::ios::binary);
      if (!input) {
        error = "无法读取音色参考音频：" + path;
        return false;
      }
      std::vector<uint8_t> bytes(static_cast<size_t>(size));
      input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
      if (!input) {
        error = "读取音色参考音频失败：" + path;
        return false;
      }
      std::vector<float> decoded;
      int rate = 0;
      int channels = 0;
      std::string detail;
      if (!decode_wav(bytes, decoded, rate, channels, detail)) {
        error = "音色参考音频无效：" + path + "：" + detail;
        return false;
      }
      if (decoded.size() < static_cast<size_t>(rate) / 10 ||
          decoded.size() > static_cast<size_t>(rate) * 60) {
        error = "音色参考音频时长必须在 0.1..60 秒之间：" + path;
        return false;
      }
      reference_key_ = key;
      reference_samples_ = std::move(decoded);
      reference_rate_ = rate;
      std::fprintf(stderr, "[index-tts] reference encoded: %s (%zu frames @ %d Hz)\n",
                   path.c_str(), reference_samples_.size(), reference_rate_);
    }
    samples = &reference_samples_;
    frames = reference_samples_.size();
    sample_rate = reference_rate_;
    return true;
  }

  void close() {
    session_.reset();
    session_options_.reset();
    model_.reset();
    registry_.reset();
    loaded_ = false;
    reference_key_.clear();
    reference_samples_.clear();
    reference_rate_ = 0;
  }

  HandleGuard<audiocpp_registry, audiocpp_registry_free> registry_;
  HandleGuard<audiocpp_model, audiocpp_model_free> model_;
  HandleGuard<audiocpp_options, audiocpp_options_free> session_options_;
  HandleGuard<audiocpp_session, audiocpp_session_free> session_;
  std::string language_;
  bool loaded_ = false;
  std::string reference_key_;
  std::vector<float> reference_samples_;
  int reference_rate_ = 0;
};

#else  // LS101_INDEX_TTS_STUB_ENGINE

// ---- synthetic tone engine (protocol tests without CUDA / audio.cpp) --------

class StubEngine final : public Engine {
 public:
  bool load(const LoadOptions& options, std::string& error) override {
    (void)error;
    std::fprintf(stderr, "[index-tts] stub engine backend=%s model=%s weight=%s language=%s threads=%d\n",
                 options.backend.c_str(), options.model_path.c_str(), options.weight_type.c_str(),
                 options.language.c_str(), options.threads);
    return true;
  }

  bool synthesize(const SynthRequest& request, std::vector<float>& samples, int& sample_rate,
                  int& channels, std::string& error) override {
    const char* fail = std::getenv("LS101_STUB_FAIL");
    if (fail && std::strcmp(fail, "0") != 0) {
      error = "stub synthesis failure";
      return false;
    }
    double seconds = 0.2;
    if (const char* configured = std::getenv("LS101_STUB_SECONDS")) {
      const double parsed = std::strtod(configured, nullptr);
      if (std::isfinite(parsed) && parsed > 0.0) seconds = parsed;
    }
    size_t frames = static_cast<size_t>(kOutputSampleRate * seconds);
    if (frames < 441) frames = 441;
    if (frames > static_cast<size_t>(kOutputSampleRate) * 30) {
      frames = static_cast<size_t>(kOutputSampleRate) * 30;
    }
    samples.resize(frames);
    const double frequency = 440.0;
    const double amplitude = 3000.0 / 32768.0;
    for (size_t index = 0; index < frames; ++index) {
      const double position = static_cast<double>(index) /
                              static_cast<double>(kOutputSampleRate);
      samples[index] = static_cast<float>(
          amplitude * std::sin(2.0 * 3.14159265358979323846 * frequency * position));
    }
    sample_rate = next_stub_sample_rate();
    channels = 1;
    (void)request;
    return true;
  }

 private:
  // Test-only knob, present only in a LS101_INDEX_TTS_STUB_ENGINE build:
  // LS101_STUB_RATE=<n>[,<n>…] overrides the sample rate the stub reports, i.e. it fakes an
  // engine that returns samples at a bogus or non-22050 rate. One comma-separated entry is
  // consumed per successful request and the last entry repeats, so a hostile-input harness can
  // force an invalid rate on one request and a healthy one on the next in the same process.
  int next_stub_sample_rate() {
    if (rate_overrides_.empty() && !rate_overrides_read_) {
      rate_overrides_read_ = true;
      const char* configured = std::getenv("LS101_STUB_RATE");
      std::string text = configured ? configured : "";
      while (!text.empty()) {
        const size_t comma = text.find(',');
        const std::string entry = text.substr(0, comma);
        text = comma == std::string::npos ? std::string() : text.substr(comma + 1);
        char* stop = nullptr;
        const long parsed = std::strtol(entry.c_str(), &stop, 10);
        if (!entry.empty() && stop && *stop == '\0' &&
            parsed >= static_cast<long>(std::numeric_limits<int>::min()) &&
            parsed <= static_cast<long>(std::numeric_limits<int>::max())) {
          rate_overrides_.push_back(static_cast<int>(parsed));
        }
      }
    }
    if (rate_overrides_.empty()) return kOutputSampleRate;
    const size_t index = std::min(rate_override_index_, rate_overrides_.size() - 1);
    ++rate_override_index_;
    return rate_overrides_[index];
  }

  std::vector<int> rate_overrides_;
  size_t rate_override_index_ = 0;
  bool rate_overrides_read_ = false;
};

#endif  // LS101_INDEX_TTS_STUB_ENGINE

std::unique_ptr<Engine> create_engine() {
#ifdef LS101_INDEX_TTS_STUB_ENGINE
  return std::unique_ptr<Engine>(new StubEngine());
#else
  return std::unique_ptr<Engine>(new AudioCppEngine());
#endif
}

// ---------------------------------------------------------------------------
// argv layer (load-time identity only)
// ---------------------------------------------------------------------------

bool parse_threads(const char* value, int& output) {
  if (!value || !*value) return false;
  char* end = nullptr;
  const long parsed = std::strtol(value, &end, 10);
  if (*end != '\0' || parsed < 1 || parsed > 256) return false;
  output = static_cast<int>(parsed);
  return true;
}

bool valid_language(const std::string& value) {
  if (value == "auto") return true;
  if (value.size() < 2 || value.size() > 8) return false;
  return std::all_of(value.begin(), value.end(), [](unsigned char character) {
    return character >= 'a' && character <= 'z';
  });
}

bool valid_weight_type(const std::string& value) {
  return value == "native" || value == "f32" || value == "f16" || value == "bf16" ||
         value == "q8_0";
}

bool parse_args(int argc, char** argv, LoadOptions& options, std::string& error) {
  bool have_threads = false;
  for (int index = 1; index < argc; ++index) {
    const std::string flag = argv[index];
    const bool has_value = index + 1 < argc;
    const char* value = has_value ? argv[++index] : nullptr;
    if (flag == "--backend") {
      if (!value) {
        error = "--backend 需要一个值";
        return false;
      }
      options.backend = value;
      if (options.backend != "cpu" && options.backend != "cuda") {
        error = "--backend 只能是 cpu 或 cuda";
        return false;
      }
    } else if (flag == "--model") {
      if (!value) {
        error = "--model 需要一个值";
        return false;
      }
      options.model_path = value;
    } else if (flag == "--weight-type") {
      if (!value) {
        error = "--weight-type 需要一个值";
        return false;
      }
      options.weight_type = value;
      if (!valid_weight_type(options.weight_type)) {
        error = "--weight-type 只能是 native、f32、f16、bf16 或 q8_0";
        return false;
      }
    } else if (flag == "--language") {
      if (!value) {
        error = "--language 需要一个值";
        return false;
      }
      options.language = value;
      if (!valid_language(options.language)) {
        error = "--language 只能是 auto 或 2..8 位小写语言代码";
        return false;
      }
    } else if (flag == "--threads") {
      if (!parse_threads(value, options.threads)) {
        error = "--threads 需要 1..256 之间的整数";
        return false;
      }
      have_threads = true;
    } else {
      error = "未知参数：" + flag;
      return false;
    }
  }
  if (options.backend.empty()) {
    error = "缺少 --backend";
    return false;
  }
  if (options.model_path.empty()) {
    error = "缺少 --model";
    return false;
  }
  if (options.weight_type.empty()) {
    error = "缺少 --weight-type";
    return false;
  }
  if (options.language.empty()) {
    error = "缺少 --language";
    return false;
  }
  if (!have_threads) {
    error = "缺少 --threads";
    return false;
  }
  return true;
}

void print_usage(const char* program) {
  std::fprintf(stderr,
               "用法：\n"
               "  %s --backend <cpu|cuda> --model <gguf 路径> \\\n"
               "      --weight-type <native|f32|f16|bf16|q8_0> --language <auto|zh|en|ja|es|ar|…> \\\n"
               "      --threads <1..256>\n",
               program);
}

// ---------------------------------------------------------------------------
// serve loop (protocol layer)
// ---------------------------------------------------------------------------

enum class HeaderRead { Line, EndOfStream, TooLong };

// Reads one LF-terminated request header line, capped at kMaxRequestHeaderBytes.
//
// The cap is deliberately a hard failure and not a recoverable one: after an over-long line
// the helper cannot tell where the `textBytes` payload that belongs to the missing header
// starts, so there is no way to resynchronise the stream. The frozen contract has no frame
// that could carry "I lost framing", and guessing would emit results against the wrong
// request ids, so serve() exits non-zero with a stderr diagnostic instead.
HeaderRead read_header_line(std::string& line) {
  line.clear();
  char character = '\0';
  while (std::cin.get(character)) {
    if (character == '\n') return HeaderRead::Line;
    if (line.size() >= kMaxRequestHeaderBytes) return HeaderRead::TooLong;
    line.push_back(character);
  }
  // A last header without a trailing LF is still a complete line for this stream (EOF means no
  // further bytes can arrive) and the previous getline()-based loop answered it, so keep that
  // behaviour. A hard stream error discards the partial line instead.
  if (std::cin.eof() && !line.empty()) return HeaderRead::Line;
  return HeaderRead::EndOfStream;
}

// Reports a failed request on stdout (the contract's error frame) and on stderr (diagnostics).
// Returns false when even the error frame could not be written, which means stdout framing is
// broken and the session must be aborted instead of serving more requests.
bool report_failure(const std::string& request_id, const std::string& message) {
  std::fprintf(stderr, "IndexTTS 合成失败（id=%s）：%s\n", request_id.c_str(), message.c_str());
  try {
    send_error(request_id, message);
    return true;
  } catch (const std::exception& exception) {
    std::fprintf(stderr, "IndexTTS 错误帧写入失败（id=%s）：%s\n", request_id.c_str(),
                 exception.what());
    return false;
  } catch (...) {
    std::fprintf(stderr, "IndexTTS 错误帧写入失败（id=%s）：未知异常\n", request_id.c_str());
    return false;
  }
}

// Handles one fully read request and writes exactly one response frame. Returns false only
// when the response could not be framed at all (see report_failure); every other failure —
// including bad_alloc and any other exception — becomes an error frame, and the caller keeps
// serving the next request.
bool handle_request(Engine& engine, const SynthRequest& request) {
  try {
    // audiocpp_request_set_text takes a NUL-terminated C string, so a NUL inside the payload
    // would silently truncate the text; reject the request instead.
    if (request.text.find('\0') != std::string::npos) {
      return report_failure(request.id, "请求文本包含 NUL（0x00）字节，C 接口无法处理");
    }

    std::vector<float> samples;
    int sample_rate = 0;
    int channels = 1;
    std::string error;
    if (!engine.synthesize(request, samples, sample_rate, channels, error)) {
      return report_failure(request.id, error);
    }

    // Validate the engine's geometry before converting or allocating anything from it. The
    // channel check runs first, so dividing by `channels` is safe.
    if (!validate_engine_channels(channels, error) ||
        !validate_engine_audio(samples.size() / static_cast<size_t>(channels), sample_rate,
                              channels, error)) {
      return report_failure(request.id, error);
    }

    const std::vector<float> mono = to_mono(samples, channels);
    std::vector<float> resampled;
    if (!resample_linear(mono, sample_rate, kOutputSampleRate, resampled, error)) {
      return report_failure(request.id, error);
    }
    const std::vector<uint8_t> wav = encode_wav(resampled, kOutputSampleRate);
    if (wav.empty()) {
      return report_failure(request.id, "生成的音频超过输出大小限制");
    }
    send_result(request.id, wav);
    return true;
  } catch (const std::exception& exception) {
    return report_failure(request.id, std::string("合成失败：") + exception.what());
  } catch (...) {
    return report_failure(request.id, "合成失败：未知异常");
  }
}

int serve(Engine& engine) {
  std::string line;
  for (;;) {
    const HeaderRead read = read_header_line(line);
    if (read == HeaderRead::EndOfStream) return 0;
    if (read == HeaderRead::TooLong) {
      std::fprintf(stderr,
                   "IndexTTS 请求头超过 %zu 字节仍未出现换行：帧边界无法恢复，进程退出\n",
                   kMaxRequestHeaderBytes);
      return 2;
    }
    if (!line.empty() && line.back() == '\r') line.pop_back();

    SynthRequest request;
    std::string error;
    if (!parse_request_header(line, request, error)) {
      std::fprintf(stderr, "IndexTTS 请求协议错误：%s\n", error.c_str());
      return 2;
    }

    bool keep_serving = true;
    try {
      request.text.resize(request.text_bytes);
      if (request.text_bytes > 0) {
        std::cin.read(request.text.data(), static_cast<std::streamsize>(request.text_bytes));
        if (static_cast<size_t>(std::cin.gcount()) != request.text_bytes) {
          std::fprintf(stderr, "IndexTTS 请求负载不完整（id=%s）\n", request.id.c_str());
          return 2;
        }
      }
      keep_serving = handle_request(engine, request);
    } catch (const std::exception& exception) {
      keep_serving = report_failure(request.id, std::string("请求处理失败：") + exception.what());
    } catch (...) {
      keep_serving = report_failure(request.id, "请求处理失败：未知异常");
    }
    if (!keep_serving) return 2;
  }
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif

  LoadOptions options;
  std::string error;
  if (!parse_args(argc, argv, options, error)) {
    std::fprintf(stderr, "参数错误：%s\n", error.c_str());
    print_usage(argv[0]);
    return 2;
  }

  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);

  // The load path runs before the `ready` frame exists, so there is no request id an error
  // frame could carry: a failure (including a thrown exception) is reported on stderr and ends
  // the process with a non-zero status, which is exactly what the lifecycle table expects
  // ("a session that exits or violates the protocol is rejected, dropped, and respawned").
  try {
    const std::unique_ptr<Engine> engine = create_engine();
    if (!engine->load(options, error)) {
      std::fprintf(stderr, "IndexTTS 引擎加载失败：%s\n", error.c_str());
      return 1;
    }
    send_ready();
    return serve(*engine);
  } catch (const std::exception& exception) {
    std::fprintf(stderr, "IndexTTS helper 异常终止：%s\n", exception.what());
    return 1;
  } catch (...) {
    std::fprintf(stderr, "IndexTTS helper 异常终止：未知异常\n");
    return 1;
  }
}
