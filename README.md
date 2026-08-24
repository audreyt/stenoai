<div align="center">
  <img src="website/public/dragonfly-logo-512.png" alt="Steno Logo" width="120" height="120">

  # Steno

  *Apple-native meeting notes with live local AI*
</div>

<p align="center">
  <a href="https://github.com/audreyt/stenoai/actions/workflows/build-release.yml"><img src="https://img.shields.io/github/actions/workflow/status/audreyt/stenoai/build-release.yml?style=for-the-badge" alt="Build"></a>
  <a href="https://github.com/audreyt/stenoai/releases"><img src="https://img.shields.io/github/v/release/audreyt/stenoai?style=for-the-badge" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License"></a>
  <img src="https://img.shields.io/badge/macOS%2026+-Apple%20Speech-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS 26+ Apple Speech">
  <img src="https://img.shields.io/badge/Windows-alpha-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows (alpha)">
</p>

> [!IMPORTANT]
> This is [Audrey Tang's maintained fork](https://github.com/audreyt/stenoai) of [stenolabs/stenoai](https://github.com/stenolabs/stenoai). It keeps the upstream file format and cross-platform fallbacks while focusing on Apple-native transcription, Traditional Chinese, and live local AI during meetings.

Steno records microphone and system audio, builds a local transcript, and keeps the meeting open as a working surface while you talk. On macOS 26 and later, Apple's system-managed SpeechTranscriber handles live and batch transcription without downloading ASR weights. The Ask bar works during the meeting and queries finalized speech through a user-owned Ollama-compatible service.

This fork's maintained local profile uses `ornith-1.5:9b` at `http://127.0.0.1:11443` for both summaries and live-meeting chat. Audio never goes to that service. Transcript text does, over loopback, when you request a summary or ask a question.

<div align="center">
  <picture>
    <source srcset="website/public/demo.gif" type="image/gif">
    <img src="website/public/readme.png" alt="Steno" width="800">
  </picture>
</div>

## Fork focus

- **Apple SpeechTranscriber** on macOS 26+, with no application-managed transcription model.
- **Traditional Chinese that switches live** by restarting the active native speech lane on `zh_TW`.
- **Ask while recording** over the finalized live transcript, with streaming answers and cancellation.
- **Self-hosted Ornith** for summary and chat through a fixed loopback endpoint.
- **Upstream compatibility** for Markdown notes, Parakeet and Whisper fallbacks, Windows, and organisation adapters.

## Upstream credit

Steno was created by the [Steno team](https://github.com/stenolabs/stenoai) and remains available under the MIT license. This fork preserves upstream notices and contribution history. Report fork-specific issues at [audreyt/stenoai/issues](https://github.com/audreyt/stenoai/issues).

## What's new in this fork

- **2026-08-24: Apple-native transcription.** SpeechTranscriber is the default on supported Macs. The system manages its locale assets, so setup does not pull Parakeet.
- **2026-08-24: Traditional Chinese live switching.** Changing the language during a recording drains and restarts the native sidecar with `zh_TW`; punctuation-only hypotheses are discarded.
- **2026-08-24: Chat during meetings.** The existing Ask bar now streams answers from the finalized live transcript while recording or paused.
- **2026-08-24: Ornith local profile.** Summaries and live chat share `ornith-1.5:9b` at `127.0.0.1:11443`.
- **2026-08-04: Obsidian sync.** Mirror notes into an Obsidian vault as Markdown without overwriting edits made in Obsidian.

## Features

- **Local audio and transcription:** microphone and system audio stay on your machine. Apple's speech service runs outside the app process but on the same Mac.
- **Apple-native live transcription:** SpeechTranscriber provides volatile and final text, timestamps, confidence, and system-managed locale assets on macOS 26+.
- **Traditional and Simplified Chinese:** explicit `zh_TW` and `zh_CN` locale selection; changing the live language restarts the active native lane instead of leaving it on the previous model.
- **Chat during the meeting:** ask about decisions, names, and follow-ups before the call ends. Each request snapshots finalized segments, keeps partial hypotheses out, and streams the answer into the existing meeting chat.
- **Bounded live-query transport:** one trusted main-window query at a time, owner-bound cancellation, recent-first transcript context, fixed size and duration limits, and no question text in process arguments or logs.
- **Ornith summary and chat:** use the same self-hosted `ornith-1.5:9b` model for both paths through `http://127.0.0.1:11443`.
- **Speaker-aware capture:** microphone and system channels remain structurally separate as `[You]` and `[Others]`, with optional local diarization.
- **Recording that coexists:** a compact pill and Ask bar stay available while you work elsewhere in the app.
- **Parakeet and Whisper fallbacks:** retain upstream engines for older macOS versions, Windows, unsupported Apple locales, and portable deployments.
- **Markdown ownership:** transcripts, summaries, notes, and reports remain ordinary files under the local Steno data directory.
- **Obsidian sync, templates, export, calendar automation, and organisation adapters:** upstream workflows remain compatible.

## Coming from Granola?

The [`granola-to-steno`](skills/granola-to-steno/README.md) skill imports Granola titles, dates, participants, summaries, and transcripts into Steno's file store. The import is idempotent and safe to schedule.

This fork also implements Granola's defining in-meeting interaction directly: the Ask bar stays active while recording. It queries only finalized live transcript segments, so you can ask what the group decided without waiting for post-processing.

## Use your notes from an agent (`/steno`)

The [`steno`](skills/steno/README.md) skill makes an AI agent aware of your local
Steno notes. Run `/steno` (or just mention your meetings) and it pulls in the
relevant notes and acts on them — answer a question across meetings, recap your
week, extract action items, or use the meetings as source material to draft a
spec, PRD, or follow-up. It can also **guide you through setting up a cloud model**
(`/steno setup`) — OpenAI, Anthropic, AWS Bedrock, or a custom endpoint.

It's read-only over your notes (never modifies them), needs only Python 3.8+ (no
dependencies), and is a drop-in agent skill — copy `skills/steno/` into your
skills folder. See [`skills/steno/README.md`](skills/steno/README.md).

## macOS Shortcuts (Optional)

<details>
<summary>Expand setup and calendar automation guide</summary>

Steno supports Apple Shortcuts via deep links using the `stenoai://` URL scheme.

- Start recording: `stenoai://record/start?name=Daily%20Standup`
- Stop recording: `stenoai://record/stop`

### How to set it up

1. Open the **Shortcuts** app on macOS.
2. Create a new shortcut (for example: "Start Steno Recording").
3. Add the **Open URLs** action.
4. Use one of the URLs above.
5. (Optional) Add a keyboard shortcut from the shortcut settings.

### Calendar event naming (optional)

If you want calendar-based names, resolve the event title in your Shortcut workflow and pass it as the `name` query value in the start URL.

Example:

`stenoai://record/start?name=Weekly%20Product%20Sync`

### Calendar event start automation (via Rules bridge)

macOS Shortcuts **cannot natively trigger** exactly at Calendar event start.  
To run this automatically on event timing, a third-party automation app is required.

This addon uses:

- **Apple Shortcuts**: builds the `stenoai://record/start?...` action.
- **Rules – Calendar Automation**: watches Calendar events and triggers the shortcut.

#### Architecture overview

1. Rules App monitors upcoming Calendar events.
2. Rules checks the event note/body for a marker keyword (for example `stenoai`).
3. If matched, Rules runs a Shortcut.
4. The Shortcut gets the next event title and opens:
   - `stenoai://record/start?name={calendar_event_title}`
5. Steno receives the URL and starts recording with that name.

#### Step-by-step setup

1. Install **Rules – Calendar Automation** on macOS.
2. Create a Shortcut in Apple Shortcuts (example name: `Steno Start From Calendar Event`).
3. In that Shortcut, add actions in this order:
   - `Find Calendar Events` (limit to `1`, sorted by start date ascending, upcoming only)
   - Extract the event title from the found event
   - `URL Encode` the title
   - `Open URLs` with:
     - `stenoai://record/start?name=<encoded title>`
4. Open Rules and create a calendar-trigger rule:
   - Source: your target calendar(s)
   - Trigger window: event start (or preferred offset)
   - Condition: event note contains `stenoai`
   - Action: run Shortcut `Steno Start From Calendar`
5. In your Calendar event notes, add the word `stenoai` for meetings that should auto-start recording.
6. Test with a near-future event:
   - create event with `stenoai` in notes,
   - wait for trigger,
   - confirm Steno starts and uses the event title as session name.

#### Notes

- Without Rules (or another automation bridge), this cannot be fully event-driven from Calendar start time.
- Keep using regular manual shortcuts (`Open URLs`) for non-automated scenarios.

Have questions or suggestions? [Join our Discord](https://discord.gg/DZ6vcQnxxu) to chat with the community.
</details>

## Models and routing

**Transcription**

- **Apple SpeechTranscriber:** default on macOS 26+. System-managed, live and batch, no application model download. The current runtime exposes 45 locales.
- **Parakeet TDT v3:** downloadable fallback for Apple Silicon and the live engine on Windows through ONNX Runtime.
- **Whisper Large V3 Turbo:** post-stop fallback for broader language coverage.

**Summary and live-meeting chat**

This fork uses one Ollama-compatible profile for both:

```text
Provider: remote
URL:      http://127.0.0.1:11443
Model:    ornith-1.5:9b
```

Steno sends only transcript-derived prompts to this endpoint. The live-query path accepts requests only from the trusted main window, caps transcript/question/answer sizes, and reports fixed errors without exposing meeting content in logs.

## Future Roadmap

### Enhanced Features
- Windows: GA hardening (alpha already ships on Windows 10/11 x64)

## Installation

Release artifacts will be published at [github.com/audreyt/stenoai/releases](https://github.com/audreyt/stenoai/releases). Until the first fork tag is available, use the local build below.

Expected artifact names:

- Apple Silicon DMG: `stenoAI-macos-arm64.dmg`
- Windows x64 installer: `stenoAI-windows-x64.exe` (alpha)

The app still runs on macOS 14.4 and later, but Apple SpeechTranscriber requires macOS 26. Older systems use the Parakeet or Whisper fallback. Intel users should stay on the upstream project's [v0.3.8](https://github.com/stenolabs/stenoai/releases/tag/v0.3.8).

### Local build

The local artifact is ad-hoc signed and is not a notarized release:

```bash
open app/dist/mac-arm64/Steno.app
```

For a downloaded unsigned build, macOS may require **System Settings → Privacy & Security → Open Anyway**, or:

```bash
xattr -cr /Applications/Steno.app
```

### Windows alpha

- **Unsigned** — SmartScreen warns on first launch; we'll code-sign before 1.0.
- **CPU-only summarisation** — the bundled Ollama runs on CPU (the NVIDIA GPU libraries are excluded to keep the download small); a separate GPU build is a follow-up. Transcription is CPU on every platform regardless.
- **Auto-update** is wired (NSIS + `latest.yml`) but updates are unsigned until code signing is in place.
- **Transcription** runs through `onnx-asr` (ONNX Runtime) instead of MLX, with the same Parakeet model and behaviour as macOS. Whisper is also available as an engine option.

Issues and feedback belong on the [fork issue tracker](https://github.com/audreyt/stenoai/issues).

## Local development

### Prerequisites

- Apple Silicon Mac
- macOS 26+ and Xcode 26+ for the Apple SpeechTranscriber sidecar
- Python 3.11 or 3.12
- Node.js 22
- Swift toolchain

### Build

```bash
git clone https://github.com/audreyt/stenoai.git
cd stenoai

python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt pyinstaller

./scripts/download-ollama.sh
./scripts/build-mic-monitor.sh arm64
./scripts/build-diarize-sidecar.sh arm64
./scripts/build-transcribe-sidecar.sh arm64

PYINSTALLER_CONFIG_DIR="$PWD/.pyinstaller" \
  python -m PyInstaller stenoai.spec --noconfirm

npm --prefix app install
npm --prefix app run build:renderer

cd app
ELECTRON_CACHE="$PWD/../.electron-cache" \
ELECTRON_BUILDER_CACHE="$PWD/../.electron-builder-cache" \
npm_config_userconfig=/dev/null \
./node_modules/.bin/electron-builder \
  --dir --publish=never \
  --config.mac.identity=- \
  --config.mac.notarize=false \
  --config.directories.output=dist
```

### Ornith profile

Run an Ollama-compatible service on the fork's dedicated loopback port:

```bash
ollama pull ornith-1.5:9b
OLLAMA_HOST=127.0.0.1:11443 ollama serve
```

Then choose **Private Server** in Settings and set the URL to `http://127.0.0.1:11443`, with `ornith-1.5:9b` as the model. The same route serves summaries and chat during recording.


## Project Structure

```
stenoai/
├── app/                  # Electron desktop app
├── src/                  # Python backend
├── website/              # Marketing site
├── recordings/           # Audio files
├── transcripts/          # Text output
└── output/              # Summaries
```

## Troubleshooting

### Debug Logs

**Setup wizard debug console:** during first-time setup, expand the debug console panel to see real-time logs of model downloads and service startup.

**Terminal logging (recommended for runtime issues):** launch the app from a terminal to stream all logs (Python subprocess output, Whisper transcription, Ollama API traffic, error stack traces):
```bash
/Applications/Steno.app/Contents/MacOS/Steno
```

**System Console:**
```bash
# View recent Steno-related logs
log show --last 10m --predicate 'process CONTAINS "Steno" OR eventMessage CONTAINS "ollama"' --info

# Monitor live logs
log stream --predicate 'eventMessage CONTAINS "ollama" OR process CONTAINS "Steno"' --level info
```

### Common Issues

- **Update didn't install**: Auto-updates are applied on next quit. Quit via the **Steno → Quit** menu (not just closing the window), then reopen.
- **No system audio / no `[Others]` speaker labels**: On macOS, allow Steno to record system audio in **System Settings → Privacy & Security → Screen & System Audio Recording**. Screen Recording access is not required.
- **`stenoai://` deep link doesn't start recording**: Make sure Steno has launched at least once after install so the URL scheme is registered. If it still fails, check the terminal log for `Protocol handler registration` output.
- **Recording stops early**: Check microphone permission, System Audio Recording permission (if recording system audio), and available disk space.
- **"Processing failed"**: Usually an Ollama service or model issue — check the terminal logs.
- **Empty transcripts**: Whisper couldn't detect speech — verify audio input levels.
- **Slow processing**: Normal for longer recordings; Ollama is CPU-intensive. If summaries are unusually slow, switch to a lighter model in Settings → AI (Gemma 4 E2B is the lightest/fastest).

### Logs Location
- **User Data**: `~/Library/Application Support/stenoai/`
- **Recordings**: `~/Library/Application Support/stenoai/recordings/`
- **Transcripts**: `~/Library/Application Support/stenoai/transcripts/`
- **Summaries**: `~/Library/Application Support/stenoai/output/`

## License

This project is licensed under the [MIT License](LICENSE).
