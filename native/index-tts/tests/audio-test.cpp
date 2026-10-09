#include "../audio.h"
#include <iostream>

int main() {
    try {
        const float samples[] = {-1.0f, 0.0f, 0.5f, 1.0f};
        const auto encoded = index_tts::encode_wav(samples, 4, 24000, 1);
        const auto decoded = index_tts::decode_wav(encoded);
        if (decoded.rate != 24000 || decoded.channels != 1 || decoded.samples.size() != 4 ||
            std::abs(decoded.samples[0] + 1.0f) > 0.0001f || std::abs(decoded.samples[2] - 0.5f) > 0.0001f) return 1;
        auto malformed = encoded;
        index_tts::put32(malformed, 40, 0xffffffff);
        bool rejected = false;
        try { index_tts::decode_wav(malformed); } catch (const std::exception &) { rejected = true; }
        if (!rejected) return 2;
        const float invalid[] = {std::numeric_limits<float>::quiet_NaN()};
        rejected = false;
        try { index_tts::encode_wav(invalid, 1, 24000, 1); } catch (const std::exception &) { rejected = true; }
        if (!rejected) return 3;
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 4;
    }
}
