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
