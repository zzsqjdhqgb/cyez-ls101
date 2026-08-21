# AIRouter model catalog

AIRouter ships a generated model metadata snapshot at
`packages/airouter/src/main/model-catalog.generated.json`. The main process imports this file
directly. Runtime model discovery still calls the configured Provider's `/models` endpoint, but it
does not contact `models.dev`.

Metadata returned by a Provider takes precedence over the bundled catalog. Catalog metadata fills
fields omitted by the Provider, and an unknown model remains usable with only its model ID.

## Sources

- Most model metadata is normalized from `https://models.dev/api.json`.
- Agnes model metadata is maintained in `scripts/airouter/model-catalog.overrides.json` from the
  official documentation index at `https://wiki.agnes-ai.com/llms.txt` and the model pages:
  `https://wiki.agnes-ai.com/en/docs/agnes-25-flash.md` and
  `https://wiki.agnes-ai.com/en/docs/agnes-20-flash.md`.

Only fields consumed by AIRouter are retained: display name, context and output limits, reasoning
support and controls, structured output support, and attachment support. Provider and model IDs are
sorted so updates produce reviewable diffs.

## Updating

Run the explicit networked update command:

```sh
yarn airouter:catalog:update
```

The generator downloads `models.dev`, merges the reviewed Agnes overrides, validates the result,
and writes the committed snapshot. If normalized content is unchanged, it preserves `generatedAt`
so an update does not create timestamp-only churn.

`yarn airouter:catalog:check` validates the committed file without network access. `scripts/setup.js`
runs that offline check during setup, postinstall, development startup, and builds. Catalog updates
must never be added to those automatic flows.

## models.dev license

The normalized `models.dev` data is provided under the MIT License. The upstream license is at
`https://github.com/anomalyco/models.dev/blob/dev/LICENSE`. The verbatim notice is stored in
`thirdparty-licenses/LICENSE.models.dev.txt` and is included in packaged applications.

Copyright (c) 2025 models.dev

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
