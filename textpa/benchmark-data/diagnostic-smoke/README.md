# Diagnostic Smoke Record

这是一次纯文字口语诊断冒烟，不包含最终分数。

- Audio: `sample.wav` (source name:
  `00174478-41df-41e8-9d0d-08256c16d87b---06fa6962-a03a-4d9d-b8f8-c1a6caaf194.wav`)
- Format: 16 kHz, mono, PCM16, 16.745 seconds
- Model: `gpt-5.6-sol`
- API style: Responses
- Reasoning effort: `medium`
- Prompt: [`../../Temp.txt`](../../Temp.txt)
- Raw acoustic cues: `cues.jsonl`
- Raw transcript: `transcripts.jsonl`
- Input manifests: `cues.jsonl.manifest.json`, `transcripts.jsonl.manifest.json`
- Raw model output: [`gpt-5.6-sol-medium.json`](gpt-5.6-sol-medium.json)

提示词要求模型只列出有声学证据支持的发音问题，并把证据冲突项放入
`uncertain_items`，不输出停顿或任何数值分数。

本次结果包含 5 个 `supported_errors` 和 3 个 `uncertain_items`。输出中的 16 个
CMU/IPA 引用片段均能在 cue 输入中逐字找到；这不是逐词诊断准确率评测，因为该
样本没有错音级人工真值。
