# Branding

`icon.svg` is the source of truth for the app icon — hand-authored, self-contained,
1024×1024. `icon-1024.png` is the rasterized master that `tauri icon` consumes.

To regenerate the icon set after editing the SVG:

```bash
qlmanage -t -s 2048 -o /tmp/iconrender branding/icon.svg
```

then mask the alpha (Quick Look flattens onto white, which would leave an opaque
square around the rounded container) and downscale to 1024 before running
`npx tauri icon branding/icon-1024.png`. Delete the generated `android/` and
`ios/` directories afterwards; this is a macOS-only app.

## The mark

A single sheet with one folded corner, on a sunset gradient. *Foglio* is Italian
for "sheet of paper", and the app opens one file in one window — the icon is the
product thesis drawn literally.

Chosen against two alternatives for one reason: it is the only one that survives
32×32. A concept built on rendering Markdown syntax marks lost its whole idea at
Dock size, and a cream-paper variant flattened into an ambiguous shape and washed
out on light backgrounds. Legibility at the smallest size decided it.
