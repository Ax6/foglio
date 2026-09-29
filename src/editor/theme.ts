import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * Only class names here — every colour lives in styles.css behind a custom
 * property, so light/dark switches with the system appearance without the
 * editor reconfiguring itself.
 */
export const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, class: "md-h1" },
  { tag: t.heading2, class: "md-h2" },
  { tag: t.heading3, class: "md-h3" },
  { tag: t.heading4, class: "md-h4" },
  { tag: t.heading5, class: "md-h5" },
  { tag: t.heading6, class: "md-h6" },
  { tag: t.strong, class: "md-strong" },
  { tag: t.emphasis, class: "md-em" },
  { tag: t.strikethrough, class: "md-strike" },
  { tag: t.monospace, class: "md-mono" },
  { tag: t.link, class: "md-link" },
  { tag: t.url, class: "md-url" },
  { tag: t.quote, class: "md-quote" },
  { tag: t.contentSeparator, class: "md-sep" },
  { tag: t.processingInstruction, class: "md-syntax" },
  { tag: t.labelName, class: "md-syntax" },

  // Fenced code blocks, highlighted by the nested language parsers.
  { tag: t.comment, class: "tok-comment" },
  { tag: [t.keyword, t.modifier, t.controlKeyword], class: "tok-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "tok-literal" },
  { tag: [t.typeName, t.className, t.namespace], class: "tok-type" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "tok-fn" },
  { tag: [t.propertyName, t.attributeName], class: "tok-property" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], class: "tok-punct" },
  { tag: [t.tagName, t.definition(t.variableName)], class: "tok-tag" },
  { tag: t.invalid, class: "tok-invalid" },
]);

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "15px",
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-body)",
    lineHeight: "1.6",
    overflowY: "auto",
    // Tables are allowed to be wider than the sheet, so the scroller has to be
    // able to reach them.
    overflowX: "auto",
  },
  // The measure lives on the line rather than the content box. Prose lines
  // centre themselves inside it; a table line opts out and runs as wide as it
  // needs (see .cm-md-table-line). Constraining .cm-content instead would force
  // tables to wrap, and a wrapped row breaks column alignment for the whole
  // table because no two rows wrap at the same column.
  // No horizontal padding: each line positions itself, because the content box
  // grows to fit the widest table and anything measured against it would drift.
  ".cm-content": {
    padding: "3rem 0 40vh",
    maxWidth: "none",
    caretColor: "var(--caret)",
  },
  // Offsets are measured from the viewport, never from the content box. A table
  // wider than the window makes the content box wider than the window too, and
  // auto margins would then centre every prose line inside that oversized box —
  // pushing the text off to the right. The editor fills the window in this app,
  // so 100vw is the width to centre within.
  ".cm-line": {
    padding: "0",
    maxWidth: "min(var(--measure), calc(100vw - 2 * var(--gutter)))",
    marginLeft: "max(var(--gutter), calc((100vw - var(--measure)) / 2))",
    marginRight: "0",
  },

  // Vertical rhythm comes from the elements. A blank source line shrinks to a
  // paragraph gap, and a heading carries its own space above. Like table layout
  // below, line spacing has to live in the theme to outrank `.cm-line` above.
  //
  // A blank line's height is fixed too, because a concealed `>` leaves inline
  // widget buffers behind that would hold it open at full height.
  ".cm-line.cm-md-blank": { lineHeight: "0.6em", height: "0.6em" },
  ".cm-line.cm-md-h1-line": { paddingTop: "0.9em" },
  ".cm-line.cm-md-h2-line": { paddingTop: "0.75em" },
  ".cm-line.cm-md-h3-line": { paddingTop: "0.5em" },
  ".cm-line.cm-md-h4-line": { paddingTop: "0.35em" },
  ".cm-line.cm-md-h5-line": { paddingTop: "0.35em" },
  ".cm-line.cm-md-h6-line": { paddingTop: "0.35em" },
  ".cm-line.cm-md-quote-line": { paddingLeft: "0.9em" },
  ".cm-line.cm-md-code-line": { padding: "0 1.1em" },
  ".cm-line.cm-md-code-first": { borderRadius: "6px 6px 0 0" },
  ".cm-line.cm-md-code-last": { borderRadius: "0 0 6px 6px" },
  ".cm-line.cm-md-code-first.cm-md-code-last": { borderRadius: "6px" },
  ".cm-line.cm-md-fence": { lineHeight: "0.9em" },
  ".cm-line.cm-md-fence-label-line": { lineHeight: "1.9em" },

  // Table layout has to live in the theme rather than in styles.css: CodeMirror
  // prefixes these selectors with its generated theme class, so `.cm-line` there
  // is a two-class selector that outranks a single-class rule in a plain
  // stylesheet. Layout for table rows would silently lose to `margin: auto`
  // above — which centres each row on its own width and staggers the columns.
  //
  // A row never wraps, and every row of one table shares an offset derived from
  // that table's widest row (--table-ch, set by the live-preview plugin). While
  // the table fits the measure the offset matches the prose; once it is wider it
  // centres in the full window, spending the margins instead of scrolling early;
  // wider than the window, it clamps to zero and scrolls.
  ".cm-line.cm-md-table-line": {
    maxWidth: "none",
    width: "max-content",
    whiteSpace: "pre",
    marginLeft:
      "max(var(--gutter), calc((100vw - max(var(--measure), var(--table-ch, 0) * 1ch)) / 2))",
    marginRight: "0",
  },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--caret)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--selection)" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--selection)" },
  ".cm-panels": {
    backgroundColor: "var(--panel)",
    color: "var(--fg)",
    borderBottom: "1px solid var(--rule)",
  },
  ".cm-panels input, .cm-panels button": {
    fontFamily: "var(--font-body)",
    fontSize: "12.5px",
  },
  ".cm-searchMatch": { backgroundColor: "var(--match)" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--match-active)" },
});
