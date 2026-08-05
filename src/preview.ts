/**
 * Dev-only harness: mounts the editor in a plain browser with a fixture so the
 * live-preview rendering can be iterated on without the Tauri shell.
 * Not part of the production build — Vite only bundles index.html.
 *
 * Append ?large to load the multi-megabyte perf fixture instead.
 */
import fixture from "../fixtures/kitchen-sink.md?raw";

import { applyMode } from "./appearance";
import { createEditor } from "./editor/editor";

const params = new URLSearchParams(location.search);

async function pick(): Promise<string> {
  if (!params.has("large")) return fixture;
  const response = await fetch("/fixtures/large.md");
  return response.ok ? response.text() : fixture;
}

applyMode("system");

const view = createEditor({
  parent: document.getElementById("editor")!,
  doc: await pick(),
  docPath: () => "/fixtures/kitchen-sink.md",
  onChange: () => {},
});

view.focus();

// Expose for poking at state from the console.
(window as unknown as { view: typeof view }).view = view;
