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
    fontSize: "15.5px",
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-body)",
    lineHeight: "1.65",
    overflowY: "auto",
    overflowX: "hidden",
  },
  ".cm-content": {
    padding: "3rem 1.75rem 40vh",
    maxWidth: "var(--measure)",
    margin: "0 auto",
    caretColor: "var(--caret)",
  },
  ".cm-line": { padding: "0" },
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
