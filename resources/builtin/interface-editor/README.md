# Bundled Interfaces

Each bundled Interface is stored independently using the FileStorage directory format:

```text
builtin/<builtinKey>/.text/current.json
builtin/<builtinKey>/versions/<sha256-digest>/.text/interface.json
```

The directory names under `builtin/` are the active builtin keys shipped by the application.

Current builtins:

- `shanghai-gaokao-speaking`: Shanghai Gaokao English speaking content, consolidated from the 27 `editableData` fields in the legacy `templates/SH-gaokao-speaking/chunk` files. Legacy file fields are represented as Interface image fields.
