import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

import { BulletWidget, CheckboxWidget, FenceLabelWidget, RuleWidget } from "./widgets";

const HIDE = Decoration.replace({});
const DIM = Decoration.mark({ class: "cm-md-dim" });
const INLINE_CODE = Decoration.mark({ class: "cm-md-inline-code" });

const LINE = {
  quote: Decoration.line({ class: "cm-md-quote-line" }),
  code: Decoration.line({ class: "cm-md-code-line" }),
  codeFirst: Decoration.line({ class: "cm-md-code-first" }),
  codeLast: Decoration.line({ class: "cm-md-code-last" }),
  fence: Decoration.line({ class: "cm-md-fence" }),
  fenceLabel: Decoration.line({ class: "cm-md-fence-label-line" }),
  blank: Decoration.line({ class: "cm-md-blank" }),
};

const HEADING_LINE = [1, 2, 3, 4, 5, 6].map((n) =>
  Decoration.line({ class: `cm-md-heading-line cm-md-h${n}-line` }),
);

const fenceLabels = new Map<string, Decoration>();
function fenceLabel(lang: string): Decoration {
  let deco = fenceLabels.get(lang);
  if (!deco) {
    deco = Decoration.replace({ widget: new FenceLabelWidget(lang) });
    fenceLabels.set(lang, deco);
  }
  return deco;
}

/**
 * A table row carries its table's widest row, in characters, so CSS can decide
 * how far left to pull the block: aligned with the prose while it fits the
 * measure, and centred in the whole window once it does not. Rows are monospace,
 * so a character count converts to a width exactly via `ch`.
 *
 * Cached because every row of every table asks for one on each rebuild, and an
 * identical decoration lets CodeMirror reuse the DOM.
 */
const tableLines = new Map<number, Decoration>();
function tableLine(widest: number): Decoration {
  let deco = tableLines.get(widest);
  if (!deco) {
    deco = Decoration.line({
      class: "cm-md-table-line",
      attributes: { style: `--table-ch:${widest}` },
    });
    tableLines.set(widest, deco);
  }
  return deco;
}

const BULLET = Decoration.replace({ widget: new BulletWidget() });
const RULE = Decoration.replace({ widget: new RuleWidget() });
const CHECKED = Decoration.replace({ widget: new CheckboxWidget(true) });
const UNCHECKED = Decoration.replace({ widget: new CheckboxWidget(false) });

const ATX_HEADING = /^ATXHeading[1-6]$/;
const PLAIN_BULLET = /^[-*+]$/;
const QUOTE_ONLY = /^\s*(?:>\s*)+$/;

interface Built {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

/**
 * Rewrites markdown syntax out of view, except where the selection sits. Only
 * the visible ranges are walked, so document size does not affect typing cost.
 */
function build(view: EditorView): Built {
  const { state } = view;
  const doc = state.doc;
  const ranges = state.selection.ranges;

  const decorations: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];

  /** Is the caret or a selection inside the element being rendered? */
  const revealed = (from: number, to: number) =>
    ranges.some((r) => r.from <= to && r.to >= from);

  const lineSpan = (from: number, to: number): [number, number] => [
    doc.lineAt(from).from,
    doc.lineAt(to).to,
  ];

  const conceal = (from: number, to: number, spec: Decoration = HIDE) => {
    if (to <= from) return;
    const range = spec.range(from, to);
    decorations.push(range);
    atomic.push(range);
  };

  for (const visible of view.visibleRanges) {
    const lineClass = (from: number, to: number, deco: Decoration) => {
      const first = doc.lineAt(Math.max(from, visible.from)).number;
      const last = doc.lineAt(Math.min(to, visible.to)).number;
      for (let n = first; n <= last; n++) {
        decorations.push(deco.range(doc.line(n).from));
      }
    };

    // Blank lines inside code are content, so they keep their height.
    const code: [number, number][] = [];

    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        switch (node.name) {
          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6":
          case "SetextHeading1":
          case "SetextHeading2": {
            const level = Number(node.name.slice(-1));
            decorations.push(HEADING_LINE[level - 1].range(doc.lineAt(node.from).from));
            break;
          }

          // `## ` — hidden with its trailing space so text aligns left.
          case "HeaderMark": {
            const parent = node.node.parent;
            if (!parent || !ATX_HEADING.test(parent.name)) break;
            const [lineFrom, lineTo] = lineSpan(parent.from, parent.to);
            if (revealed(lineFrom, lineTo)) break;
            let end = node.to;
            while (end < lineTo && doc.sliceString(end, end + 1) === " ") end++;
            conceal(node.from, end);
            break;
          }

          // Inline emphasis reveals per element, not per line, like Obsidian.
          case "EmphasisMark":
          case "StrikethroughMark": {
            const parent = node.node.parent;
            const from = parent ? parent.from : node.from;
            const to = parent ? parent.to : node.to;
            if (revealed(from, to)) break;
            conceal(node.from, node.to);
            break;
          }

          // Shared between `` `inline` `` and fenced blocks; the fences of a
          // block stay legible and simply recede.
          case "CodeMark": {
            const parent = node.node.parent;
            if (!parent) break;
            if (parent.name === "InlineCode") {
              if (revealed(parent.from, parent.to)) break;
              conceal(node.from, node.to);
            } else {
              decorations.push(DIM.range(node.from, node.to));
            }
            break;
          }

          case "CodeInfo":
            decorations.push(DIM.range(node.from, node.to));
            break;

          case "InlineCode":
            decorations.push(INLINE_CODE.range(node.from, node.to));
            break;

          // Keeps the label of `[text](url)`. Images are left as raw text
          // because v1 does not render them, and an autolink keeps its URL.
          case "LinkMark":
          case "URL": {
            const parent = node.node.parent;
            if (!parent) break;
            const isLink = parent.name === "Link";
            const isAutolinkBracket =
              parent.name === "Autolink" && node.name === "LinkMark";
            if (!isLink && !isAutolinkBracket) break;
            if (revealed(parent.from, parent.to)) break;
            conceal(node.from, node.to);
            break;
          }

          case "QuoteMark": {
            const [lineFrom, lineTo] = lineSpan(node.from, node.to);
            if (revealed(lineFrom, lineTo)) break;
            let end = node.to;
            if (doc.sliceString(end, end + 1) === " ") end++;
            conceal(node.from, end);
            break;
          }

          case "ListMark": {
            if (!PLAIN_BULLET.test(doc.sliceString(node.from, node.to))) break;
            const [lineFrom, lineTo] = lineSpan(node.from, node.to);
            if (revealed(lineFrom, lineTo)) break;
            conceal(node.from, node.to, BULLET);
            break;
          }

          case "TaskMarker": {
            const [lineFrom, lineTo] = lineSpan(node.from, node.to);
            if (revealed(lineFrom, lineTo)) break;
            const checked =
              doc.sliceString(node.from, node.to).toLowerCase() !== "[ ]";
            conceal(node.from, node.to, checked ? CHECKED : UNCHECKED);
            break;
          }

          case "HorizontalRule": {
            const [lineFrom, lineTo] = lineSpan(node.from, node.to);
            if (revealed(lineFrom, lineTo)) break;
            conceal(lineFrom, lineTo, RULE);
            break;
          }

          case "Blockquote":
            lineClass(node.from, node.to, LINE.quote);
            break;

          case "FencedCode":
          case "CodeBlock": {
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            lineClass(node.from, node.to, LINE.code);
            decorations.push(LINE.codeFirst.range(first.from), LINE.codeLast.range(last.from));
            code.push([first.from, last.to]);
            if (node.name === "CodeBlock" || revealed(first.from, last.to)) break;

            // Fences recede into the block's padding. The opening one keeps the
            // language as a label; an unclosed block has no closing fence.
            const info = node.node.getChild("CodeInfo");
            const lang = info ? doc.sliceString(info.from, info.to) : "";
            conceal(first.from, first.to, lang ? fenceLabel(lang) : HIDE);
            decorations.push((lang ? LINE.fenceLabel : LINE.fence).range(first.from));
            if (node.node.getChildren("CodeMark").length > 1) {
              conceal(last.from, last.to);
              decorations.push(LINE.fence.range(last.from));
            }
            break;
          }

          case "Table": {
            // Measured across the entire table, not just its visible rows, or
            // the offset would shift as the table scrolls into view.
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            let widest = 0;
            for (let n = first; n <= last; n++) {
              widest = Math.max(widest, doc.line(n).text.length);
            }
            lineClass(node.from, node.to, tableLine(widest));
            break;
          }

          case "TableDelimiter":
            decorations.push(DIM.range(node.from, node.to));
            break;
        }
      },
    });

    // A blank source line only separates blocks, so it shrinks to a gap. A
    // quote line holding only `>` does too, until the caret reveals its marker.
    for (let pos = visible.from; pos <= visible.to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      const blank = !line.text.trim();
      if (!blank && !(QUOTE_ONLY.test(line.text) && !revealed(line.from, line.to))) continue;
      if (code.some(([from, to]) => line.from >= from && line.from <= to)) continue;
      decorations.push(LINE.blank.range(line.from));
    }
  }

  return {
    decorations: Decoration.set(decorations, true),
    atomic: Decoration.set(atomic, true),
  };
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
      ({ decorations: this.decorations, atomic: this.atomic } = build(view));
    }

    update(update: ViewUpdate) {
      const reparsed = syntaxTree(update.state) !== syntaxTree(update.startState);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        reparsed
      ) {
        ({ decorations: this.decorations, atomic: this.atomic } = build(
          update.view,
        ));
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // Without this the caret can get stranded inside concealed syntax.
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.atomic ?? Decoration.none,
      ),
  },
);
