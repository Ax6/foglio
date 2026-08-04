import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from "@codemirror/view";

import { linkClicks } from "./links";
import { livePreview } from "./live-preview";
import { editorTheme, markdownHighlight } from "./theme";

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  /** Read lazily so link resolution follows Save As. */
  docPath: () => string | null;
  onChange: () => void;
}

export function createEditor(options: EditorOptions): EditorView {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSpecialChars(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    search({ top: true }),

    // GFM (tables, task lists, strikethrough, autolinks) ships with
    // markdownLanguage; codeLanguages lazy-imports fence grammars on demand.
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      addKeymap: true,
    }),
    syntaxHighlighting(markdownHighlight),
    livePreview,
    editorTheme,
    linkClicks(options.docPath),

    // Save/Open/New are native menu accelerators, which macOS resolves before
    // the webview sees the key, so they are deliberately absent here.
    keymap.of([
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),

    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange();
    }),
  ];

  return new EditorView({
    parent: options.parent,
    state: EditorState.create({ doc: options.doc, extensions }),
  });
}
