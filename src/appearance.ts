/**
 * Appearance. The palette is selected by a `data-theme` attribute holding a
 * concrete "light" or "dark"; this module is what resolves the user's chosen
 * mode — which may be "system" — into one of those, and keeps following the
 * system while that is the mode.
 */

export type Mode = "system" | "light" | "dark";

const DARK = "(prefers-color-scheme: dark)";

let current: Mode = "system";
let media: MediaQueryList | null = null;

function resolve(mode: Mode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia(DARK).matches ? "dark" : "light";
}

function paint(mode: Mode) {
  document.documentElement.dataset.theme = resolve(mode);
}

/**
 * Apply a mode, and listen for system changes only while following the system —
 * an explicit choice should not move when macOS switches appearance.
 */
export function applyMode(mode: Mode) {
  current = mode;
  paint(mode);

  if (!media) {
    media = window.matchMedia(DARK);
    media.addEventListener("change", () => {
      if (current === "system") paint(current);
    });
  }
}
