# Bundled Interfaces

Each bundled Interface is stored independently using the FileStorage directory format:

```text
builtin/<builtinKey>/.text/current.json
builtin/<builtinKey>/versions/<sha256-digest>/.text/interface.json
```

The directory names under `builtin/` are the active builtin keys shipped by the application.
