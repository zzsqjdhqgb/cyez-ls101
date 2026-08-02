<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# Cao'er Ting Shuo 101

An English listening and speaking exam system built with Electron + React + TypeScript, supporting multimedia playback, recording, draft editing, template management, grading, and scoring features.

## Core Features

- **Multimedia Exam Playback**: Supports text, images, audio, video, quad-image grid, and other content types
- **Three Time Control Modes**: Countdown preparation, auto-recording, media playback control
- **Exam Templates & Draft System**: Create drafts from templates, fill in text/upload files, export a complete exam package with one click
- **Offline Text-to-Speech (TTS)**: Built-in Pocket TTS engine (WASM), no network required, 7 English voice tones
- **Recording**: Auto-recording during exams with alert tones before and after recording
- **Grading System**: Import submission packages → score by item → settle → export CSV/PDF grading reports
- **Adaptive Scaling**: Fixed 3:2 aspect ratio (1200×800 design size), scales proportionally at any window size
- **Exam Format Validation**: Built-in structural validity checks and resource file existence verification
- **Developer Mode**: Question number display, skip button, F12 DevTools, data reset, and more

## Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Frontend Framework | React + TypeScript | 19 |
| Desktop Framework | Electron | 39 |
| Build Tool | electron-vite + Vite | 5.0 / 7.2 |
| Code Style | ESLint 9 + Prettier 3 | |
| Packaging & Distribution | electron-builder | 26 |
| TTS Engine | Pocket TTS (WASM) | Local offline |

## Environment Requirements

- Node.js >= 18
- pnpm

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

This command automatically performs the following initialization tasks:
- Downloads TTS model files
- Downloads developer avatars
- Generates corresponding `.ico` files from `resources/file-icons/*.png`

### 2. Download TTS Model Files (Optional, but TTS will be unavailable without them)

```bash
node scripts/download-tts-assets.js
```

### 3. Start Development Server

```bash
pnpm dev
```

### 4. Preview Build Output

```bash
pnpm start
```

## Project Structure

```
├── assets/                     # TTS model files (need to be downloaded via script)
│   ├── tts_b6369a24.safetensors
│   ├── tokenizer.model
│   └── embeddings_v2/          # 7 voice tone embedding vectors
├── build/
│   ├── icon.png                # Application icon
│   └── icon.icns               # macOS application icon
├── exams/                      # Pre-built exam packages (copied to userData on first launch)
├── templates/                  # Pre-built templates (copied to userData on first launch)
├── resources/
│   ├── icon.png                # Backup application icon
│   ├── file-icons/             # File type icons (.png source files in git, .ico/.icns generated and gitignored)
│   ├── media/                  # Built-in media resources (alert tones, avatars)
│   └── tts/                    # TTS WASM runtime
├── scripts/                    # Utility scripts
│   ├── download-tts-assets.js  # Download TTS model files
│   ├── setup.js               # Unified entry for downloading models & generating icons
│   ├── generate-icons.js       # Generate ICO file icons from PNG
│   ├── generate_exam.py        # (Legacy) MiniMax API exam generation
│   └── insert_ready_and_stop.py # (Legacy) Insert recording alert tones
├── src/
│   ├── main/                   # Electron main process
│   │   ├── index.ts            # Entry point, initialization, protocol registration, file association
│   │   ├── win.ts              # Window management
│   │   ├── utils.ts            # File system utility functions
│   │   ├── utils/
│   │   │   └── file-association.ts  # File extension registration/removal
│   │   ├── ipc/                # IPC handlers
│   │   │   ├── app.ts          # App-level IPC (open file import on double-click)
│   │   │   ├── exam.ts         # Exam management
│   │   │   ├── submission.ts   # Submission management
│   │   │   ├── template.ts     # Template management
│   │   │   ├── draft/          # Draft management (management/export/transfer)
│   │   │   ├── grading.ts      # Grading management
│   │   │   └── dev.ts          # Developer tools
│   │   └── tts/
│   │       └── tts.ts          # Pocket TTS engine wrapper
│   ├── preload/                # Preload scripts
│   │   └── index.ts            # contextBridge exposed APIs
│   ├── renderer/               # Renderer process (React)
│   │   └── src/
│   │       ├── App.tsx          # Router entry point
│   │       ├── types.ts         # Type definitions
│   │       ├── hooks/           # Custom Hooks
│   │       │   └── useOpenFileHandler.ts  # Double-click file open handler
│   │       ├── pages/           # Page components
│   │       └── components/      # UI components
│   └── shared/
│       ├── file-types.ts       # File type constants and utility functions
│       └── validation.ts       # Exam format validation
├── docs/                       # Documentation
│   ├── file-types.md           # File types and extension conventions
│   ├── architecture.md         # System architecture overview
│   ├── exam-format.md          # Exam format specification
│   ├── template-format.md      # Template format specification
│   ├── grading-system.md       # Grading system
│   ├── data-storage.md         # Data storage structure
│   ├── tts-engine.md           # TTS engine
│   ├── user-guide.md           # User guide
│   ├── troubleshooting.md      # Common troubleshooting
│   └── testing-checklist.md    # Testing checklist
├── electron-builder.yml        # Packaging configuration
├── package.json
└── tsconfig.json
```

## File Types & Extensions

This application uses custom file extensions to identify different types of exchange files. All custom files are internally standard ZIP format, with data read and written by `adm-zip`.

| Extension | Purpose | Module |
|-----------|---------|--------|
| `.cyexam` | Exam package | Exam management |
| `.cytmpl` | Template package | Create Exam > Templates |
| `.cydraft` | Draft package | Create Exam > Drafts |
| `.cysubm` | Submission package | Submission list / Grading management |

File extensions are written to system associations by `electron-builder` during installation and supplemented by `src/main/utils/file-association.ts` at launch. File icons are auto-generated during `pnpm install` by `scripts/generate-icons.js` (PNG → ICO).

See also: [File Types & Extensions Documentation (docs/file-types.md)](docs/file-types.md)

## Exam Format

Exams are defined in JSON format with the following core structure:

```json
{
  "title": "Exam Title",
  "questions": [
    {
      "id": "1",
      "content": [ /* Array of content nodes */ ],
      "time": { /* Time control */ },
      "statusText": "Optional status bar text"
    }
  ],
  "gradingInfo": [ /* Optional: grading items */ ]
}
```

Five supported content node types: `text`, `image`, `video`, `audio`, `quad-image`.
Three time control modes: `countdown`, `record`, `content-controlled`.

For detailed format specifications, see: [Exam Format Specification (exam-format.md)](docs/exam-format.md)

## Exam Templates

Templates define customizable exams using placeholders (`{{id}}`). Users create drafts from templates, fill in text, upload files, and then export standard exam packages. `audio` nodes in templates are automatically synthesized into audio via the built-in TTS engine during export.

See also: [Template Format Specification (docs/template-format.md)](docs/template-format.md)

## Time Control Mode Descriptions

### Countdown (countdown)
- Displays countdown seconds, automatically advances to the next question when it reaches zero
- Suitable for preparation and review stages

### Recording (record)
- Displays recording progress bar and remaining seconds
- Plays "get ready to record" alert tone → starts recording → auto-stops on timeout → plays "stop recording" alert tone
- Recording files are saved as MP3 by `recordIndex`

### Content-Controlled (content-controlled)
- Automatically advances to the next question when audio/video playback ends
- **Must contain exactly one** video or audio node
- May also include text, images, and other auxiliary content

## Grading System

Supports a complete grading workflow:
1. **Import Submissions**: Teacher imports student-submitted ZIP files, with automatic deduplication
2. **Item-by-Item Scoring**: Score each grading item individually and write comments, with split-screen playback of recordings
3. **Settle Scores**: After all scoring is complete, create a batch and calculate total scores
4. **Export**: Batches can be exported as CSV spreadsheets or PDF reports

See also: [Grading System Documentation (docs/grading-system.md)](docs/grading-system.md)

## Custom Resource Protocol

The application uses custom Electron protocols to load local resources without starting a local HTTP server:

| Protocol | Purpose |
|----------|---------|
| `exam-resource://{eid}/` | Load exam media resources |
| `grading-resource://{rid}/` | Load grading-related resources (recordings, exam papers) |
| `app-resource://` | Load built-in application resources (alert tones, avatars) |

All protocols support streaming, bypass CSP, and include built-in path traversal protection.

## Adaptive Scaling

The application uses a fixed **3:2** design aspect ratio (1200×800 pixels), scaling content via CSS `transform: scale()`:
- Maintains content proportions at any resolution and window size
- Excess space is filled with a black background
- All text, images, buttons, and other elements scale proportionally

## TTS Engine

Built-in Pocket TTS text-to-speech engine (WebAssembly), runs offline, supports 7 English voice tones (default is alba). Synthesis parameters: 24000 Hz sample rate, PCM 16-bit, mono WAV output.

See also: [TTS Engine Documentation (docs/tts-engine.md)](docs/tts-engine.md)

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server (hot reload) |
| `pnpm start` | Preview build output |
| `pnpm build` | Build production version |
| `pnpm build:win` | Build Windows installer |
| `pnpm build:mac` | Build macOS installer |
| `pnpm build:linux` | Build Linux installer |
| `pnpm lint` | Run ESLint checks |
| `pnpm lint:fix` | Auto-fix ESLint issues |
| `pnpm format` | Format code with Prettier |
| `pnpm typecheck` | TypeScript type checking |

## Build & Distribution

| Platform | Command | Output Format |
|----------|---------|---------------|
| Windows | `pnpm build:win` | NSIS installer |
| macOS | `pnpm build:mac` | DMG |
| Linux | `pnpm build:linux` | AppImage / Snap / deb |

Build output is located in the `dist/` directory.

## Documentation Index

| Document | Description |
|----------|-------------|
| [file-types.md](docs/file-types.md) | File types and extension conventions |
| [architecture.md](docs/architecture.md) | System architecture overview |
| [exam-format.md](docs/exam-format.md) | Exam format specification |
| [template-format.md](docs/template-format.md) | Template format specification |
| [grading-system.md](docs/grading-system.md) | Grading system |
| [data-storage.md](docs/data-storage.md) | Data storage structure |
| [tts-engine.md](docs/tts-engine.md) | TTS engine |
| [user-guide.md](docs/user-guide.md) | User guide |
| [troubleshooting.md](docs/troubleshooting.md) | Common troubleshooting |

## License

Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.

This software is proprietary and confidential. No part of this software may be reproduced, modified, or distributed in any medium without the explicit authorization of the copyright holder.

## Third-Party Components

- **Pocket TTS** (MIT): Speech synthesis model and ONNX WASM export
- **adm-zip** (MIT): ZIP compression/decompression
- **marked** (MIT): Markdown to HTML conversion
- **react-markdown + remark-gfm** (MIT): React Markdown rendering
