# 发音纠错 Demo（CMUdict + CTC GOP）

音频：`/workspace/.gop-research/exam/recording-11.webm`
参考文本来源：local Qwen3 ASR via /workspace/scripts/test-stt.js

> 本报告只讨论音素发音，不分析语法、措辞、内容、停顿或总分。声学证据需要结合原音频复听，不能单独视为人工判定。

## 发音疑点

### 词首浊塞音 /b/ · 较弱证据，仅作待确认复听项

部分词首 /b/ 更接近 /p/；同一模型可能有系统性混淆，因此不能直接断言。

证据：
- `books` 00:02.56-00:02.58：/b/ → /p/（GOP 对数比 -2.277763，置信度 0.569）
- `books` 00:13.82-00:13.85：/b/ → /p/（GOP 对数比 -6.508749，置信度 1.0）

练习方向：双唇先闭合、随后带声释放；避免像 /p/ 一样出现明显送气。


## 方法与限制

- 音素模型：`/workspace/.gop-research/model`
- 对齐方法：CTC Viterbi；GOP 方法：`viterbi`（auto fallback: estimated work 1,207,993,192 > 2,000,000）
- CMUdict：`/workspace/node_modules/cmu-pronouncing-dictionary/index.js`
- 参考词数：130；对齐音素数：449
- ASR 转写只是临时对齐文本；未知词、错词和合法读音变体不会被自动改写成发音错误。
- `i5` 等多语内部 token 不会出现在此 CMU 音素模型的反馈中。
