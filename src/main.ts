import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

import { applyMode, type Mode } from "./appearance";
import { createEditor } from "./editor/editor";
import * as ipc from "./ipc";
import { askToSave, showBanner } from "./prompt";

const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mdx", "txt"];
const DIRTY_DEBOUNCE_MS = 120;

const win = getCurrentWindow();

let docPath: string | null = null;
let savedText = "";
let knownMtime: number | null = null;
let isDirty = false;
let view: EditorView;

function displayName() {
  if (!docPath) return "Untitled";
  return docPath.slice(docPath.lastIndexOf("/") + 1);
}

function load(doc: ipc.Doc) {
  docPath = doc.path;
  savedText = doc.content;
  knownMtime = doc.mtime;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc.content },
    selection: { anchor: 0 },
    // A programmatic load is not something Cmd-Z should walk back into.
    annotations: Transaction.addToHistory.of(false),
  });
  void applyDirty(false);
  void win.setTitle(displayName());
}

async function applyDirty(next: boolean) {
  if (next === isDirty) return;
  isDirty = next;
  await ipc.setDirty(next);
}

let dirtyTimer: number | undefined;
function scheduleDirtyCheck() {
  clearTimeout(dirtyTimer);
  dirtyTimer = window.setTimeout(() => {
    void applyDirty(view.state.doc.toString() !== savedText);
  }, DIRTY_DEBOUNCE_MS);
}

async function save(saveAs = false): Promise<boolean> {
  let target = docPath;

  if (!target || saveAs) {
    const picked = await saveDialog({
      defaultPath: target ?? "Untitled.md",
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (!picked) return false;
    target = picked;
  }

  const content = view.state.doc.toString();
  try {
    const result = await ipc.saveFile(target, content);
    docPath = result.path;
    knownMtime = result.mtime;
    savedText = content;
    clearTimeout(dirtyTimer);
    await applyDirty(false);
    await win.setTitle(displayName());
    return true;
  } catch (error) {
    showBanner(`Could not save: ${error}`, true);
    return false;
  }
}

/** Re-read on focus: cheap enough to skip a filesystem watcher in v1. */
async function checkExternalChange() {
  if (!docPath) return;
  const mtime = await ipc.statMtime(docPath);
  if (mtime == null || mtime === knownMtime) return;

  if (isDirty) {
    knownMtime = mtime;
    showBanner("This file changed on disk. Saving will overwrite those changes.", true);
    return;
  }
  load(await ipc.readFile(docPath));
  showBanner("Reloaded — the file changed on disk.");
}

async function main() {
  // Before anything is drawn — the window stays hidden until `ready`, so
  // resolving the palette here means it is never seen in the wrong appearance.
  applyMode((await ipc.appearanceMode()) as Mode);

  const doc = await ipc.bootstrap();
  docPath = doc.path;
  savedText = doc.content;
  knownMtime = doc.mtime;

  view = createEditor({
    parent: document.getElementById("editor")!,
    doc: doc.content,
    docPath: () => docPath,
    onChange: scheduleDirtyCheck,
  });
  view.focus();

  await win.listen<ipc.Doc>("foglio://open", (event) => load(event.payload));

  await win.listen<string>("foglio://theme", (event) => applyMode(event.payload as Mode));

  // File > Save / Save As. New and Open are handled entirely in Rust.
  await win.listen<string>("foglio://menu", (event) => {
    if (event.payload === "save") void save();
    else if (event.payload === "save_as") void save(true);
  });

  await win.onCloseRequested(async (event) => {
    if (!isDirty) return;
    event.preventDefault();
    const choice = await askToSave(displayName());
    if (choice === "cancel") return;
    if (choice === "save" && !(await save())) return;
    await applyDirty(false);
    await ipc.forceClose();
  });

  await win.onFocusChanged(({ payload: focused }) => {
    if (focused) void checkExternalChange();
  });

  await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== "drop") return;
    for (const path of event.payload.paths) {
      const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      if (MARKDOWN_EXTENSIONS.includes(ext)) void ipc.openPath(path);
    }
  });
}

// The window stays hidden until `ready`, so it must be called even if setup
// partly failed — otherwise there is nothing on screen to report the problem.
main()
  .catch((error) => {
    document.getElementById("editor")!.textContent = `foglio failed to start: ${error}`;
  })
  .finally(() => {
    void ipc.ready();
  });
