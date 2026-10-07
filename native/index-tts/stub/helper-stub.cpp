// Scratch verification double for ls101-index-tts-helper.
//
// It implements the frozen stdio contract (docs/engineering/index-tts.md) without loading any
// model, so the Electron-side synthesizer can be exercised against a real child process:
//
//   argv : --backend <cpu|cuda> --model <path> --weight-type <t> --language <l> --threads <n>
//          (load-time identity only; the double echoes --backend on stderr)
//   stdin: {"op":"synthesize","id":"<id>","textBytes":<N>,...}\n + exactly N UTF-8 bytes
//   stdout: {"type":"ready","version":1}\n
//           {"type":"result","requestId":"<id>","sampleRate":22050,"size":<S>}\n + S WAV bytes
//           {"type":"error","requestId":"<id>","size":<M>}\n + M message bytes
//   env  : LS101_STUB_FAIL=1 -> answer with an error frame
//          LS101_STUB_SECONDS=<f> -> audio duration per request (default 0.2 s)
//
// Failure handling mirrors native/index-tts/main.cpp, including where the line between a fatal
// protocol error and a recoverable request failure is drawn:
//
//   * `op` must be present and exactly "synthesize", `id` must be a legal request id
//     (^[a-zA-Z0-9_-]{1,64}$, the decoder's rule) and `textBytes` must be a JSON integer in
//     0..65536; the line must be one complete JSON object with nothing after it. A header the
//     double refuses to trust desynchronises stdin — it cannot know where that request's payload
//     ends — so it is unrecoverable: a stderr diagnostic and exit 2, with no error frame
//     (main.cpp's serve() does the same for a failed parse_request_header()).
//   * a payload that stops before `textBytes` bytes (EOF or a stream error), or a header line
//     that exceeds the 64 KiB cap without a newline, is the same kind of framing failure: stderr
//     diagnostic, exit 2. A last header without its trailing LF is *not* a failure: EOF means no
//     further bytes can arrive, so it is answered as a complete line, exactly like main.cpp's
//     read_header_line().
//   * failures *after* a well-formed header and a fully consumed payload leave the stream
//     boundary intact (a NUL inside the text, LS101_STUB_FAIL, an internal encoding failure), so
//     they answer with the contract's error frame and the double keeps serving.
//
// Diagnostics go to stderr only. On Windows the standard streams are switched to binary mode
// before the first byte is written, otherwise the CRT expands every 0x0A in the WAV payload into
// 0x0D 0x0A and `size` no longer matches the bytes on the wire.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

// ---------------------------------------------------------------------------
// Protocol constants (same values as native/index-tts/main.cpp)
// ---------------------------------------------------------------------------

constexpr int kProtocolVersion = 1;
constexpr int kSampleRate = 22050;                    // the contract's fixed output rate
constexpr size_t kWavHeaderBytes = 44;                // canonical RIFF/WAVE header
constexpr size_t kMaxTextBytes = 64 * 1024;           // main.cpp kMaxTextBytes / decoder text cap
constexpr size_t kMaxRequestHeaderBytes = 64 * 1024;  // main.cpp kMaxRequestHeaderBytes
constexpr size_t kMaxErrorBytes = 4096;               // decoder error-payload cap
constexpr uint32_t kMinFrames = 441;                  // 20 ms, the shortest tone the double emits
constexpr double kMaxSeconds = 30.0;                  // longest tone the double emits

// ---------------------------------------------------------------------------
// Exact-byte writers (stdout serves two protocols at once: JSON lines and raw payloads)
// ---------------------------------------------------------------------------

// Writes `bytes` bytes verbatim. Returns false when the stream could not take all of them, which
// means stdout framing is broken and the session must stop.
bool writeRaw(const void* data, size_t bytes) {
  if (bytes == 0) return true;
  std::cout.write(static_cast<const char*>(data), static_cast<std::streamsize>(bytes));
  return std::cout.good();
}

bool sendReady() {
  const std::string frame = "{\"type\":\"ready\",\"version\":" + std::to_string(kProtocolVersion) +
                            "}\n";
  if (!writeRaw(frame.data(), frame.size())) return false;
  std::cout.flush();
  return std::cout.good();
}

// Writes one result frame: the header declares exactly the number of raw bytes that follow.
bool sendResult(const std::string& request_id, const std::string& wav) {
  const std::string header = "{\"type\":\"result\",\"requestId\":\"" + request_id +
                             "\",\"sampleRate\":" + std::to_string(kSampleRate) +
                             ",\"size\":" + std::to_string(wav.size()) + "}\n";
  if (!writeRaw(header.data(), header.size())) return false;
  if (!writeRaw(wav.data(), wav.size())) return false;
  std::cout.flush();
  return std::cout.good();
}

// Writes one error frame (UTF-8 diagnostic payload, capped like the real helper).
bool sendError(const std::string& request_id, const std::string& message) {
  const std::string payload =
      message.size() > kMaxErrorBytes ? message.substr(0, kMaxErrorBytes) : message;
  const std::string header = "{\"type\":\"error\",\"requestId\":\"" + request_id +
                             "\",\"size\":" + std::to_string(payload.size()) + "}\n";
  if (!writeRaw(header.data(), header.size())) return false;
  if (!writeRaw(payload.data(), payload.size())) return false;
  std::cout.flush();
  return std::cout.good();
}

// Recoverable failure: the request boundary is intact, so report it on stderr and answer with the
// contract's error frame. Returns false when even that frame could not be written, which means
// stdout framing is broken and the session must stop (main.cpp's report_failure).
bool reportFailure(const std::string& request_id, const std::string& message) {
  std::fprintf(stderr, "IndexTTS 合成失败（id=%s）：%s\n", request_id.c_str(), message.c_str());
  return sendError(request_id, message);
}

// Unrecoverable framing failure: diagnostics on stderr, exit 2, never an error frame.
int protocolError(const std::string& message) {
  std::fprintf(stderr, "IndexTTS 请求协议错误：%s\n", message.c_str());
  return 2;
}

// ---------------------------------------------------------------------------
// Minimal JSON member reader for the one-line request header
// ---------------------------------------------------------------------------

bool isJsonSpace(char character) {
  return character == ' ' || character == '\t' || character == '\r' || character == '\n';
}

// Scans the JSON string starting at `position` (which must be '"'); on success `end` points just
// past the closing quote. Escapes are skipped, not decoded.
bool scanJsonString(const std::string& line, size_t position, size_t& end) {
  size_t cursor = position + 1;
  while (cursor < line.size()) {
    const char character = line[cursor];
    if (character == '\\') {
      cursor += 2;
      continue;
    }
    if (character == '"') {
      end = cursor + 1;
      return true;
    }
    ++cursor;
  }
  return false;
}

// Scans the JSON value starting at `position`, skipping nested objects and arrays, and leaves
// `end` just past the value. Only framing is checked here; the caller interprets the span.
bool scanJsonValue(const std::string& line, size_t position, size_t& end) {
  if (position >= line.size()) return false;
  const char first = line[position];
  if (first == '"') return scanJsonString(line, position, end);
  if (first == '{' || first == '[') {
    int depth = 0;
    size_t cursor = position;
    while (cursor < line.size()) {
      const char character = line[cursor];
      if (character == '"') {
        size_t string_end = 0;
        if (!scanJsonString(line, cursor, string_end)) return false;
        cursor = string_end;
        continue;
      }
      if (character == '{' || character == '[') {
        ++depth;
      } else if (character == '}' || character == ']') {
        --depth;
        if (depth == 0) {
          end = cursor + 1;
          return true;
        }
      }
      ++cursor;
    }
    return false;
  }
  size_t cursor = position;
  while (cursor < line.size() && line[cursor] != ',' && line[cursor] != '}' && line[cursor] != ']') {
    ++cursor;
  }
  end = cursor;
  return end > position;
}

// Decodes the simple escapes JSON.stringify emits for a request id. A "\uXXXX" escape is left
// as-is: such a value can never be a legal request id, so it is rejected either way.
std::string decodeJsonString(const std::string& raw) {
  std::string value;
  value.reserve(raw.size());
  for (size_t index = 0; index < raw.size(); ++index) {
    const char character = raw[index];
    if (character != '\\' || index + 1 >= raw.size()) {
      value.push_back(character);
      continue;
    }
    const char escape = raw[++index];
    switch (escape) {
      case '"': value.push_back('"'); break;
      case '\\': value.push_back('\\'); break;
      case '/': value.push_back('/'); break;
      case 'b': value.push_back('\b'); break;
      case 'f': value.push_back('\f'); break;
      case 'n': value.push_back('\n'); break;
      case 'r': value.push_back('\r'); break;
      case 't': value.push_back('\t'); break;
      default:
        value.push_back('\\');
        value.push_back(escape);
    }
  }
  return value;
}

struct JsonMember {
  bool is_string = false; // its value is a JSON string
  bool is_number = false; // its value is a JSON number
  std::string string_value;
  double number_value = 0.0;
};

// Reads the top-level member named `key`. A name is only recognised in a member-name position
// (after '{' or a ','), so a value that happens to spell the key is not mistaken for it.
JsonMember readJsonMember(const std::string& line, const std::string& key) {
  JsonMember member;
  size_t cursor = line.find('{');
  if (cursor == std::string::npos) return member;
  ++cursor;
  while (cursor < line.size()) {
    while (cursor < line.size() && isJsonSpace(line[cursor])) ++cursor;
    if (cursor >= line.size() || line[cursor] == '}') return member;
    size_t name_end = 0;
    if (line[cursor] != '"' || !scanJsonString(line, cursor, name_end)) return member;
    const std::string name = line.substr(cursor + 1, name_end - cursor - 2);
    cursor = name_end;
    while (cursor < line.size() && isJsonSpace(line[cursor])) ++cursor;
    if (cursor >= line.size() || line[cursor] != ':') return member;
    ++cursor;
    while (cursor < line.size() && isJsonSpace(line[cursor])) ++cursor;
    const size_t value_start = cursor;
    size_t value_end = 0;
    if (!scanJsonValue(line, value_start, value_end)) return member;

    if (name == key) {
      std::string raw = line.substr(value_start, value_end - value_start);
      while (!raw.empty() && isJsonSpace(raw.back())) raw.pop_back();
      if (!raw.empty() && raw.front() == '"' && raw.size() >= 2 && raw.back() == '"') {
        member.is_string = true;
        member.string_value = decodeJsonString(raw.substr(1, raw.size() - 2));
      } else if (raw != "true" && raw != "false" && raw != "null") {
        char* stop = nullptr;
        const double parsed = std::strtod(raw.c_str(), &stop);
        if (stop != raw.c_str() && static_cast<size_t>(stop - raw.c_str()) == raw.size()) {
          member.is_number = true;
          member.number_value = parsed;
        }
      }
      return member;
    }

    cursor = value_end;
    while (cursor < line.size() && isJsonSpace(line[cursor])) ++cursor;
    if (cursor < line.size() && line[cursor] == ',') {
      ++cursor;
      continue;
    }
    return member;
  }
  return member;
}

// One complete JSON object and nothing else, the precondition main.cpp's JsonHeader applies. The
// diagnostics below are main.cpp's own strings for the shapes this scanner can tell apart; the
// double is not a full JSON parser, so a malformed *value* is still caught by the field checks.
bool completeJsonObject(const std::string& line, std::string& error) {
  size_t cursor = 0;
  while (cursor < line.size() && isJsonSpace(line[cursor])) ++cursor;
  if (cursor >= line.size() || line[cursor] != '{') {
    error = "请求头必须是 JSON 对象";
    return false;
  }
  int depth = 0;
  while (cursor < line.size()) {
    const char character = line[cursor];
    if (character == '"') {
      size_t string_end = 0;
      if (!scanJsonString(line, cursor, string_end)) {
        error = "JSON 字符串未闭合";
        return false;
      }
      cursor = string_end;
      continue;
    }
    if (character == '{' || character == '[') {
      ++depth;
    } else if (character == '}' || character == ']') {
      --depth;
      if (depth == 0) {
        size_t rest = cursor + 1;
        while (rest < line.size() && isJsonSpace(line[rest])) ++rest;
        if (rest != line.size()) {
          error = "请求头包含多余内容";
          return false;
        }
        return true;
      }
    }
    ++cursor;
  }
  error = "JSON 对象格式错误";
  return false;
}

// The decoder accepts ^[a-zA-Z0-9_-]{1,64}$ as a request id; the double holds the client to it.
bool validRequestId(const std::string& value) {
  if (value.empty() || value.size() > 64) return false;
  for (const unsigned char character : value) {
    const bool legal = (character >= 'a' && character <= 'z') ||
                       (character >= 'A' && character <= 'Z') ||
                       (character >= '0' && character <= '9') || character == '-' ||
                       character == '_';
    if (!legal) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// WAV encoding: mono PCM16 at 22050 Hz (the contract's fixed output geometry)
// ---------------------------------------------------------------------------

void writeLittleEndian(std::string& output, uint32_t value) {
  output.push_back(static_cast<char>(value & 0xff));
  output.push_back(static_cast<char>((value >> 8) & 0xff));
  output.push_back(static_cast<char>((value >> 16) & 0xff));
  output.push_back(static_cast<char>((value >> 24) & 0xff));
}

void writeLittleEndian16(std::string& output, uint16_t value) {
  output.push_back(static_cast<char>(value & 0xff));
  output.push_back(static_cast<char>((value >> 8) & 0xff));
}

std::string makeWav(double seconds) {
  // Clamp in double space so a hostile LS101_STUB_SECONDS can never overflow the frame count.
  const double duration =
      std::isfinite(seconds) && seconds > 0.0 ? (seconds < kMaxSeconds ? seconds : kMaxSeconds)
                                             : 0.0;
  uint32_t frames = static_cast<uint32_t>(static_cast<double>(kSampleRate) * duration);
  if (frames < kMinFrames) frames = kMinFrames;
  const uint32_t data_bytes = frames * 2;

  std::string wav;
  wav.reserve(kWavHeaderBytes + data_bytes);
  wav += "RIFF";
  writeLittleEndian(wav, 36 + data_bytes);
  wav += "WAVEfmt ";
  writeLittleEndian(wav, 16);
  writeLittleEndian16(wav, 1);  // PCM
  writeLittleEndian16(wav, 1);  // mono
  writeLittleEndian(wav, static_cast<uint32_t>(kSampleRate));
  writeLittleEndian(wav, static_cast<uint32_t>(kSampleRate) * 2);
  writeLittleEndian16(wav, 2);   // block align
  writeLittleEndian16(wav, 16);  // bits per sample
  wav += "data";
  writeLittleEndian(wav, data_bytes);
  const double amplitude = 3000.0;
  for (uint32_t index = 0; index < frames; index += 1) {
    const double t = static_cast<double>(index) / kSampleRate;
    const int16_t sample =
        static_cast<int16_t>(amplitude * std::sin(2.0 * 3.14159265358979 * 440.0 * t));
    writeLittleEndian16(wav, static_cast<uint16_t>(sample));
  }
  // `size` in the result frame is wav.size(), so a mismatch here would desynchronise the stream.
  if (wav.size() != kWavHeaderBytes + static_cast<size_t>(data_bytes)) return {};
  return wav;
}

// ---------------------------------------------------------------------------
// Header reader (the cap and the failure split match main.cpp's read_header_line)
// ---------------------------------------------------------------------------

enum class HeaderRead { Line, EndOfStream, TooLong };

HeaderRead readHeaderLine(std::string& line) {
  line.clear();
  char character = '\0';
  while (std::cin.get(character)) {
    if (character == '\n') return HeaderRead::Line;
    if (line.size() >= kMaxRequestHeaderBytes) return HeaderRead::TooLong;
    line.push_back(character);
  }
  // EOF means no further bytes can arrive, so a last header without its trailing LF is still a
  // complete line and is answered normally; only the 64 KiB cap above is fatal. Same rule as
  // main.cpp's read_header_line(): a hard stream error (not EOF) drops the partial line instead.
  if (std::cin.eof() && !line.empty()) return HeaderRead::Line;
  return HeaderRead::EndOfStream;
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  // Raw payload bytes: without binary mode the CRT rewrites every 0x0A as 0x0D 0x0A.
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif

  // Parse and echo the load-time flags so the caller can assert they arrived.
  std::string backend = "cpu";
  for (int i = 1; i < argc; ++i) {
    const std::string flag = argv[i];
    if (flag == "--backend" && i + 1 < argc) backend = argv[++i];
  }
  std::fprintf(stderr, "stub helper backend=%s\n", backend.c_str());

  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);

  if (!sendReady()) {
    std::fprintf(stderr, "IndexTTS helper 异常终止：无法写入 ready 帧\n");
    return 2;
  }

  const char* fail_env = std::getenv("LS101_STUB_FAIL");
  const bool fail = fail_env && std::strcmp(fail_env, "0") != 0;
  const char* seconds_env = std::getenv("LS101_STUB_SECONDS");
  const double seconds = seconds_env ? std::atof(seconds_env) : 0.2;

  for (;;) {
    std::string header;
    const HeaderRead read = readHeaderLine(header);
    if (read == HeaderRead::EndOfStream) return 0;
    if (read == HeaderRead::TooLong) {
      std::fprintf(stderr,
                   "IndexTTS 请求头超过 %zu 字节仍未出现换行：帧边界无法恢复，进程退出\n",
                   kMaxRequestHeaderBytes);
      return 2;
    }
    if (!header.empty() && header.back() == '\r') header.pop_back();

    // Header validation mirrors main.cpp's parse_request_header(); every failure below is fatal
    // for the same reason: an untrusted header leaves the next payload boundary unknown.
    std::string json_error;
    if (!completeJsonObject(header, json_error)) return protocolError(json_error);
    const JsonMember op_member = readJsonMember(header, "op");
    if (!op_member.is_string || op_member.string_value != "synthesize") {
      return protocolError("不支持的 op（需要 synthesize）");
    }
    const JsonMember id_member = readJsonMember(header, "id");
    if (!id_member.is_string || !validRequestId(id_member.string_value)) {
      return protocolError("请求 id 缺失或非法");
    }
    const JsonMember text_bytes = readJsonMember(header, "textBytes");
    if (!text_bytes.is_number || !std::isfinite(text_bytes.number_value) ||
        std::floor(text_bytes.number_value) != text_bytes.number_value ||
        text_bytes.number_value < 0.0 ||
        text_bytes.number_value > static_cast<double>(kMaxTextBytes)) {
      return protocolError("textBytes 缺失或超出 0..65536");
    }
    const std::string request_id = id_member.string_value;

    const size_t bytes = static_cast<size_t>(text_bytes.number_value);
    std::string text(bytes, '\0');
    if (bytes > 0) {
      std::cin.read(&text[0], static_cast<std::streamsize>(bytes));
      if (std::cin.gcount() != static_cast<std::streamsize>(bytes)) {
        std::fprintf(stderr, "IndexTTS 请求负载不完整（id=%s）\n", request_id.c_str());
        return 2;
      }
    }

    // From here on the request boundary is intact, so every failure is an error frame and the
    // double keeps serving — the same split main.cpp's handle_request() draws.
    if (text.find('\0') != std::string::npos) {
      if (!reportFailure(request_id, "请求文本包含 NUL（0x00）字节，C 接口无法处理")) return 2;
      continue;
    }
    if (fail) {
      if (!reportFailure(request_id, "stub synthesis failure")) return 2;
      continue;
    }

    const std::string wav = makeWav(seconds);
    if (wav.empty()) {
      if (!reportFailure(request_id, "生成的音频编码失败")) return 2;
      continue;
    }
    if (!sendResult(request_id, wav)) {
      std::fprintf(stderr, "IndexTTS helper 异常终止：无法写入结果帧（id=%s）\n",
                   request_id.c_str());
      return 2;
    }
  }
}
