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
- `shanghai-zhongkao-listening`: Independent A1/A2/B1 listening prompt Interface for Zhongkao learners, using the same 133-field listening contract. It has no bundled exam template until the question format is confirmed.

## Teacher listening prompts

The teacher-supplied prompts map to two listening Interfaces. They do not belong to the speaking Interfaces:

| Interface        | Difficulty prompts                    | Default when only the base prompt is selected |
| ---------------- | ------------------------------------- | --------------------------------------------- |
| 上海高考英语听力 | 低（B2）, 中（B2+～C1）, 高（C1～C2） | 低（B2）                                      |
| 上海中考英语听力 | A1, A2, B1                            | A1                                            |

Select one difficulty prompt and provide the topic or source material in the generation dialog's additional requirements. Each difficulty prompt includes the common requirements and can be used independently. Generate three separate instances with the same topic for a three-level set. The application still generates one structured instance per request. Field examples illustrate the data format; they are not calibrated CEFR examples.

Both prompts preserve the teacher's 20-question, 25-point structure: ten short dialogues played once, two passages with three questions each and one long conversation with four questions played twice. The Zhongkao Interface currently has no bundled exam template. Its 20-question, 25-point format is retained only inside the teacher prompt as an unconfirmed practice proposal; it must not be presented as an official Zhongkao paper.

The adapted prompts include sample-based calibration, per-level ASL/ASW/RE ranges, GL as a report-only value, vocabulary and syntax, speech rate targets, phonetic phenomena, information density, oral strategies, cognitive distributions, and distractor strength. They also require option-only review, truncated-evidence review, answer evidence/uniqueness checks, and cross-question disclosure checks. All are model instructions, not a claim of automated measurement or validation against real students.

The original chat/document workflow is adapted to the current application contract:

- Planning, vocabulary/context preparation, F-K estimation and per-question checks are performed before the final JSON. Missing topic/source content must be supplied before writing a paper; the prompt must not invent it. There is no multi-turn confirmation workflow in the generation API.
- The existing 133 fields carry source material, questions, options and answer letters. They do not carry teacher reports, explanations, annotated reading scripts or Markdown documents. These must not be inserted into student options or TTS text. `writeDocument(as_artifact=true)` is not an available generation tool.
- Material uses `[Man]:` / `[Woman]:` for the application's TTS roles. Directions and repeat counts are controlled by the template. Teacher recording marks (`|`, `‿`, `Repeat`) are not inserted into TTS source text.
- Audio is produced later when compiling a template. These prompts specify target rates but do not configure per-level TTS speed, measure audio duration or regenerate audio. Actual wpm must not be claimed without measurement.

Changing these limitations requires separate workflow/field/audio implementation; a prompt change alone does not implement document export, interactive checkpoints or audio calibration.
