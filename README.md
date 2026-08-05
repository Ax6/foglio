# Foglio MD

A lightweight, fast Markdown reader and editor for macOS. Opens a file like a
little document — one file, one window, nothing else.

Editing works the way Obsidian's live preview does: Markdown renders in place,
and the raw syntax reappears only on the element your caret is in.

```bash
foglio notes.md
```

## Install

```bash
brew install Ax6/tap/foglio
```

Or double-click any `.md` file in Finder once Foglio MD is set as the handler.

## Why it's small and quick

Foglio MD is a [Tauri 2](https://tauri.app) shell around
[CodeMirror 6](https://codemirror.net), rendering in the system WebKit view. No
bundled browser engine, so the whole app is a fraction of the size of an
Electron equivalent, and windows open hidden and are revealed only once the
editor has painted — there is no blank flash on launch.

Measured on an M-series Mac:

| | |
| --- | --- |
| `.app` bundle | 3.4 MB single-arch, 7.0 MB universal (3.8 MB download) |
| Cold start to visible window | ~535 ms |
| Second window in a running app | ~305 ms |
| Keystroke on a 3 MB / 155k-line file | 1.2 ms median, 3.7 ms p95 |

Syntax concealment is recomputed only for the lines actually on screen, which
is why document size barely affects typing cost.

## What v1 does

- GitHub-flavoured Markdown: headings, emphasis, strikethrough, lists, task
  checkboxes, tables, links, blockquotes, horizontal rules
- Fenced code blocks with syntax highlighting, loaded on demand per language
- Clickable task checkboxes
- Cmd-click to follow a link; relative `.md` links open in a new Foglio MD window
- Follows the system light/dark appearance
- Reloads automatically when the file changes on disk and you have no unsaved edits

Deliberately out of scope for v1: vaults, a sidebar, tabs, a settings UI, image
rendering, LaTeX math, and Mermaid diagrams.

## Menu and keys

The File menu carries New Window, Open File…, Save, Save As… and Close. New and
Open are handled in Rust; Save is forwarded to the focused window, which is the
only place the buffer lives.

| Key | Action |
| --- | --- |
| `Cmd-N` | New window |
| `Cmd-O` | Open file… |
| `Cmd-S` | Save |
| `Cmd-Shift-S` | Save As… |
| `Cmd-F` | Find |
| `Cmd-W` | Close (prompts if unsaved) |

These are native menu accelerators rather than editor keybindings — macOS
resolves them before the webview sees the keystroke, so they work regardless of
what has focus inside the window.

Tables render as aligned monospace text rather than as laid-out tables; editing
them stays plain-text simple. Images are left as source text.

## Development

Requires Rust and Node.

```bash
npm install
npm run tauri dev
```

To iterate on the editor rendering alone, without the native shell, there is a
browser harness that mounts the editor against `fixtures/kitchen-sink.md`:

```bash
npm run dev
```

then open `http://localhost:1420/preview.html`.

For a perf check, generate a large fixture and append `?large` to that URL:

```bash
python3 -c "b=open('fixtures/kitchen-sink.md').read(); open('fixtures/large.md','w').write('\n\n'.join(b.replace('# foglio kitchen sink', f'# Section {i}') for i in range(1543)))"
```

### Layout

| Path | Role |
| --- | --- |
| `src/editor/live-preview.ts` | Conceals and reveals Markdown syntax — the core of the editing feel |
| `src/editor/theme.ts` | Highlight tags mapped to CSS classes |
| `src/styles.css` | All colours and typography, light and dark |
| `src-tauri/src/windows.rs` | The single funnel all four file-open routes lead into |
| `src-tauri/src/lib.rs` | Plugins, run loop, Apple Event handling |
| `packaging/foglio.rb` | Homebrew cask, copied into the tap on release |

### Releasing

`src-tauri/tauri.conf.json` holds the version; a tag that disagrees with it
fails the build.

1. Bump the version there, commit, push.
2. `git tag -a vX.Y.Z -m "foglio X.Y.Z" && git push origin vX.Y.Z`
3. The workflow builds a universal binary, checks with `lipo` that both slices
   are present, publishes `foglio-X.Y.Z-universal.app.tar.gz`, and prints the
   `version` and `sha256` in its job summary.
4. Paste those two values into `Casks/foglio.rb` in
   [Ax6/homebrew-tap](https://github.com/Ax6/homebrew-tap) and push. Keep
   `packaging/foglio.rb` here in sync as the template.

To exercise the pipeline without cutting a release, run the workflow manually —
it builds and uploads an artifact but publishes nothing.

Builds are unsigned until an Apple Developer ID is configured. Adding the
`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and
`APPLE_TEAM_ID` secrets switches the workflow onto its signed path with no
other changes. Until then the cask strips the quarantine flag on install, which
is what lets Gatekeeper allow the app through.
