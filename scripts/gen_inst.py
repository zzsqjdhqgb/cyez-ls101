#
# Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
# Proprietary code. Use is subject to the LICENSE file in the repository root.
#

import asyncio
import edge_tts

async def synthesize(text: str, filename: str, voice: str = "zh-CN-XiaoxiaoNeural"):
    """使用微软Edge TTS合成语音"""
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(filename)
    print(f"已生成: {filename}")

async def main():
    await asyncio.gather(
        synthesize("准备录音", "start_recording.mp3"),
        synthesize("停止录音", "stop_recording.mp3")
    )

if __name__ == "__main__":
    asyncio.run(main())