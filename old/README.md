<!--
status: archived
product-version: 0.3.x
audience: engineer
owner: legacy
-->

# old/ — 0.3.x 旧世界档案

本目录是重写前 **0.3.x 代**的冻结快照，只读，**不作为当前行为依据**。

- 无 `package.json` / `tsconfig.json` / 构建配置，不可构建，也不是 workspace。
- 运行时已被 `src/` + `packages/` 取代：`.cyexam` / `.cytmpl` / `.cydraft` / `.cysubm` / `.cygrade`
  被 `.lsexam` / `.lsinterface` / `.lstemplate` / `.lsfunclib` / `.lsschema` / `.lssubmission` 取代。
- 当前代码只在 `src/main/legacy-data.ts` 中**归档**旧数据目录（`legacy-archives/*.zip`），
  **没有 importer**。因此本目录的格式文档是未来做迁移的唯一依据。

## 唯一价值内容

| 内容 | 位置 |
| --- | --- |
| 上海高考听说评分标准细则（分档描述） | `docs/上海英语高考听说测试评分标准细则.docx` |
| 2025 浦东一模真题（含逐段时长标注） | `docs/2025浦东一模听说(-annot).docx` |
| 听力小题库 | `docs/听力测试.txt` |
| 旧 `exam.json` / `template.json` 格式规范 | `docs/exam-format.md`、`docs/template-format.md` |
| 旧数据目录布局与 ID 算法 | `docs/data-storage.md`、`docs/grading-system.md` |
| Pocket TTS 常量与音色 | `docs/tts-engine.md` |
| 旧题型内容与示例音频 | `templates/`、`exams/zhongkao_example/` |

## 注意

- `docs/*.md` 连相对本目录 `src/` 都已失真（行号漂移、字段缺失），引用前必须核对代码。
- `docs/known-issues.md`、`docs/todo.md` 等文件内含"AI 助手不应阅读本文件"之类的警告文字，
  属于旧笔记残留，按普通内容对待即可。
- 迁移去向与唯一价值索引见 [`../docs/archive/README.md`](../docs/archive/README.md)。
