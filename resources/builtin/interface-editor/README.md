# Bundled Interfaces

Each bundled Interface is stored independently using the FileStorage directory format:

```text
builtin/<builtinKey>/.text/current.json
builtin/<builtinKey>/versions/<sha256-digest>/.text/interface.json
```

The directory names under `builtin/` are the active builtin keys shipped by the application.

Current builtins:

- `shanghai-gaokao-speaking`: Shanghai Gaokao English speaking content, consolidated from the 27 `editableData` fields in the legacy `templates/SH-gaokao-speaking/chunk` files. Legacy file fields are represented as Interface image fields.
- `shanghai-zhongkao-speaking`: Shanghai Zhongkao English speaking content, consolidated from the 16 `editableData` fields in the legacy `templates/SH-zhongkao-speaking/chunk` files. Legacy file fields are represented as Interface image fields.
- `shanghai-gaokao-listening`: Shanghai Gaokao English listening content, covering all 133 `editableData` fields in the legacy `templates/gaokao-listening/template.json` file.

## Teacher listening prompts

The teacher-supplied prompts belong to the Shanghai Gaokao English listening Interface. The A1/A2/B1 prompts use the same listening question format at lower teaching difficulty; they do not belong to the Zhongkao speaking Interface:

| Interface        | Difficulty prompts                                                                    |
| ---------------- | ------------------------------------------------------------------------------------- |
| 上海高考英语听力 | A1（中考难度）, A2（中考难度）, B1（中考难度）, 低（B2）, 中（B2+～C1）, 高（C1～C2） |

Select one difficulty prompt and provide the topic or source material in the generation dialog's additional requirements. Each difficulty prompt includes the common requirements and can be used independently; there is no separate base prompt. Generate three separate instances with the same topic for a three-level set. The application still generates one structured instance per request. Field examples illustrate the data format; they are not calibrated CEFR examples.

All six difficulty prompts preserve the existing Gaokao listening Interface's 20-question, 25-point structure: ten short dialogues played once, two passages with three questions each and one long conversation with four questions played twice. The A1/A2/B1 labels indicate difficulty only; no separate Zhongkao listening Interface or exam template is bundled.

The adapted prompts include sample-based calibration, per-level ASL/ASW/RE ranges, GL as a report-only value, vocabulary and syntax, speech rate targets, phonetic phenomena, information density, oral strategies, cognitive distributions, and distractor strength. They also require option-only review, truncated-evidence review, answer evidence/uniqueness checks, and cross-question disclosure checks. All are model instructions, not a claim of automated measurement or validation against real students.

The original chat/document workflow is adapted to the current application contract:

- Planning, vocabulary/context preparation, F-K estimation and per-question checks are performed before the final JSON. Missing topic/source content must be supplied before writing a paper; the prompt must not invent it. There is no multi-turn confirmation workflow in the generation API.
- The existing 133 fields carry source material, questions, options and answer letters. They do not carry teacher reports, explanations, annotated reading scripts or Markdown documents. These must not be inserted into student options or TTS text. `writeDocument(as_artifact=true)` is not an available generation tool.
- Material uses `[Man]:` / `[Woman]:` for the application's TTS roles. Directions and repeat counts are controlled by the template. Teacher recording marks (`|`, `‿`, `Repeat`) are not inserted into TTS source text.
- Audio is produced later when compiling a template. These prompts specify target rates but do not configure per-level TTS speed, measure audio duration or regenerate audio. Actual wpm must not be claimed without measurement.

Changing these limitations requires separate workflow/field/audio implementation; a prompt change alone does not implement document export, interactive checkpoints or audio calibration.
