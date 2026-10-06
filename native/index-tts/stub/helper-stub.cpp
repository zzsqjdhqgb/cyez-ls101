// Scratch verification double for ls101-index-tts-helper.
// It implements the frozen stdio contract without loading any model, so the
// Electron-side synthesizer can be exercised against a real child process.
//
//   argv : --backend <cpu|cuda> --model <path> --weight-type <t> --language <l> --threads <n>
//   stdin: {"op":"synthesize","id":"<id>","textBytes":<N>,...}\n + exactly N UTF-8 bytes
//   stdout: {"type":"ready","version":1}\n
//           {"type":"result","requestId":"<id>","sampleRate":22050,"size":<S>}\n + S WAV bytes
//           {"type":"error","requestId":"<id>","size":<M>}\n + M message bytes
//   env  : LS101_STUB_FAIL=1 -> answer with an error frame
//          LS101_STUB_SECONDS=<f> -> audio duration per request
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>

namespace {

std::string jsonString(const std::string& line, const std::string& key) {
  const std::string needle = "\"" + key + "\":\"";
  const size_t start = line.find(needle);
  if (start == std::string::npos) return {};
  const size_t valueStart = start + needle.size();
  const size_t end = line.find('"', valueStart);
  if (end == std::string::npos) return {};
  return line.substr(valueStart, end - valueStart);
}

long jsonNumber(const std::string& line, const std::string& key, long fallback) {
  const std::string needle = "\"" + key + "\":";
  const size_t start = line.find(needle);
  if (start == std::string::npos) return fallback;
  const char* begin = line.c_str() + start + needle.size();
  char* end = nullptr;
  const long value = std::strtol(begin, &end, 10);
  return end == begin ? fallback : value;
}

void writeLittleEndian(std::string& out, uint32_t value) {
  out.push_back(static_cast<char>(value & 0xff));
  out.push_back(static_cast<char>((value >> 8) & 0xff));
  out.push_back(static_cast<char>((value >> 16) & 0xff));
  out.push_back(static_cast<char>((value >> 24) & 0xff));
}

void writeLittleEndian16(std::string& out, uint16_t value) {
  out.push_back(static_cast<char>(value & 0xff));
  out.push_back(static_cast<char>((value >> 8) & 0xff));
}

std::string makeWav(const std::string& text, double seconds) {
  const uint32_t sampleRate = 22050;
  uint32_t frames = static_cast<uint32_t>(sampleRate * seconds);
  if (frames < 441) frames = 441;
  if (frames > sampleRate * 30) frames = sampleRate * 30;
  const uint32_t dataBytes = frames * 2;
  std::string wav;
  wav.reserve(44 + dataBytes);
  wav += "RIFF";
  writeLittleEndian(wav, 36 + dataBytes);
  wav += "WAVEfmt ";
  writeLittleEndian(wav, 16);
  writeLittleEndian16(wav, 1);
  writeLittleEndian16(wav, 1);
  writeLittleEndian(wav, sampleRate);
  writeLittleEndian(wav, sampleRate * 2);
  writeLittleEndian16(wav, 2);
  writeLittleEndian16(wav, 16);
  wav += "data";
  writeLittleEndian(wav, dataBytes);
  const double amplitude = 3000.0;
  for (uint32_t i = 0; i < frames; i += 1) {
    const double t = static_cast<double>(i) / sampleRate;
    const int16_t sample = static_cast<int16_t>(amplitude * std::sin(2.0 * 3.14159265358979 * 440.0 * t));
    writeLittleEndian16(wav, static_cast<uint16_t>(sample));
  }
  (void)text;
  return wav;
}

std::string readLine() {
  std::string line;
  if (!std::getline(std::cin, line)) return {};
  if (!line.empty() && line.back() == '\r') line.pop_back();
  return line;
}

}  // namespace

int main(int argc, char** argv) {
  // Parse and echo the load-time flags so the caller can assert they arrived.
  std::string backend = "cpu";
  for (int i = 1; i < argc; ++i) {
    const std::string flag = argv[i];
    if (flag == "--backend" && i + 1 < argc) backend = argv[++i];
  }
  std::fprintf(stderr, "stub helper backend=%s\n", backend.c_str());

  std::cout << "{\"type\":\"ready\",\"version\":1}\n" << std::flush;

  const char* failEnv = std::getenv("LS101_STUB_FAIL");
  const bool fail = failEnv && std::strcmp(failEnv, "0") != 0;
  const char* secondsEnv = std::getenv("LS101_STUB_SECONDS");
  const double seconds = secondsEnv ? std::atof(secondsEnv) : 0.2;

  for (;;) {
    const std::string header = readLine();
    if (header.empty()) break;
    const std::string id = jsonString(header, "id");
    const long textBytes = jsonNumber(header, "textBytes", -1);
    if (id.empty() || textBytes < 0) break;
    std::string text(static_cast<size_t>(textBytes), '\0');
    if (textBytes > 0) std::cin.read(&text[0], textBytes);

    if (fail) {
      const std::string message = "stub synthesis failure";
      std::cout << "{\"type\":\"error\",\"requestId\":\"" << id << "\",\"size\":" << message.size()
                << "}\n"
                << message << std::flush;
      continue;
    }

    const std::string wav = makeWav(text, seconds);
    std::cout << "{\"type\":\"result\",\"requestId\":\"" << id << "\",\"sampleRate\":22050,\"size\":"
              << wav.size() << "}\n";
    std::cout.write(wav.data(), static_cast<std::streamsize>(wav.size()));
    std::cout.flush();
  }
  return 0;
}
