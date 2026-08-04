import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { EditorView } from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";

import { openPath } from "../ipc";

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

/** The link target under `pos`, if any. */
export function linkTargetAt(view: EditorView, pos: number): string | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "Link" || node.name === "Autolink") {
      const url = node.getChild("URL");
      if (url) return view.state.sliceDoc(url.from, url.to).trim();
      if (node.name === "Autolink") {
        return view.state.sliceDoc(node.from + 1, node.to - 1).trim();
      }
      return null;
    }
    node = node.parent;
  }
  return null;
}

function parentDir(filePath: string): string {
  const at = filePath.lastIndexOf("/");
  return at <= 0 ? "/" : filePath.slice(0, at);
}

async function follow(target: string, docPath: string | null) {
  if (target.startsWith("#")) return;

  if (ABSOLUTE.test(target)) {
    await openUrl(target);
    return;
  }

  // Relative link: another document next to this one.
  const base = docPath ? parentDir(docPath) : null;
  if (!base) return;
  const [pathPart] = target.split("#");
  if (!pathPart) return;
  await openPath(pathPart.startsWith("/") ? pathPart : `${base}/${pathPart}`);
}

/** Cmd-click opens; a plain click just places the caret and reveals syntax. */
export function linkClicks(docPath: () => string | null) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.metaKey || event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const target = linkTargetAt(view, pos);
      if (!target) return false;
      event.preventDefault();
      void follow(target, docPath());
      return true;
    },
  });
}
