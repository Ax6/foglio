import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
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
  gapAbove: Decoration.line({ class: "cm-md-gap-above" }),
  gapBelow: Decoration.line({ class: "cm-md-gap-below" }),
};

/**
 * Top-level blocks that sit a block gap apart even when no blank line separates
 * them, as every Markdown renderer spaces them. Link definitions stay packed.
 */
const SPACED = new Set([
  "Paragraph",
  "BulletList",
  "OrderedList",
  "Blockquote",
  "FencedCode",
  "CodeBlock",
  "Table",
  "HorizontalRule",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
]);

// Drawn as boxes, so a gap beside them goes outside the box.
const BOXED = new Set(["FencedCode", "CodeBlock", "Table"]);

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

/**
 * A list line indents by its nesting depth. An item's first line hangs its
 * marker in the indent, so wrapped and continuation lines start where the text
 * does. A lazy continuation line has no indentation to hang, so it only indents.
 * An item that a blank line does not already separate takes a small gap.
 */
const listLines = new Map<string, Decoration>();
function listLine(depth: number, hang: boolean, gap = false): Decoration {
  const key = `${depth}:${hang}:${gap}`;
  let deco = listLines.get(key);
  if (!deco) {
    let cls = "cm-md-list-line";
    if (hang) cls += " cm-md-list-hang";
    if (gap) cls += " cm-md-list-gap";
    deco = Decoration.line({ class: cls, attributes: { style: `--list-depth:${depth}` } });
    listLines.set(key, deco);
  }
  return deco;
}

// The indentation, marker and spaces before an item's text, set as one box.
// Inclusive, or an empty item's box would collapse around its bullet widget.
const PREFIX = Decoration.mark({ class: "cm-md-list-prefix", inclusive: true });
const ORDERED_PREFIX = Decoration.mark({
  class: "cm-md-list-prefix cm-md-list-ordered",
  inclusive: true,
});

// Disc, circle, square by bullet-list depth, as T3 Code and browsers draw them.
const BULLETS = ["•", "◦", "▪"].map((glyph) =>
  Decoration.replace({ widget: new BulletWidget(glyph) }),
);

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
 * Rewrites markdown syntax out of view, except where the caret sits. Only
 * the visible ranges are walked, so document size does not affect typing cost.
 */
function build(view: EditorView): Built {
  const { state } = view;
  const doc = state.doc;
  const ranges = state.selection.ranges;

  const decorations: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];

  /**
   * Is the caret, or the fixed end of a selection, inside the element being
   * rendered? The moving end reveals nothing, so a selection being dragged
   * never shifts text under the pointer.
   */
  const revealed = (from: number, to: number) =>
    ranges.some((r) => r.anchor >= from && r.anchor <= to);

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

  /**
   * Where the indentation before `pos` begins. A concealed quote mark takes
   * one space with it, so that space stays out of the list's prefix box.
   */
  const indentFrom = (lineFrom: number, pos: number) => {
    let from = pos;
    while (from > lineFrom && /[ \t]/.test(doc.sliceString(from - 1, from))) from--;
    if (from > lineFrom && doc.sliceString(from - 1, from + 1) === "> ") from++;
    return from;
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
        // Two top-level blocks on adjacent lines still get the gap a blank line
        // would give them. It goes above the later block, or below the earlier
        // one when the later is a box.
        if (SPACED.has(node.name) && node.from >= visible.from) {
          const block = node.node;
          const prev = block.prevSibling;
          const line = doc.lineAt(block.from);
          if (
            block.parent?.type.isTop &&
            prev &&
            SPACED.has(prev.name) &&
            doc.lineAt(prev.to).number === line.number - 1
          ) {
            if (!BOXED.has(block.name)) decorations.push(LINE.gapAbove.range(line.from));
            else if (!BOXED.has(prev.name)) decorations.push(LINE.gapBelow.range(doc.lineAt(prev.to).from));
          }
        }

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

          // The prefix box keeps one width whether the marker shows its source
          // or its rendering, so revealing it never moves the text. The marker
          // reveals only while the caret touches the prefix, like emphasis.
          case "ListItem": {
            const item = node.node;
            const mark = item.firstChild;
            if (mark?.name !== "ListMark") break;

            let depth = 0;
            let bulletDepth = 0;
            for (let n: SyntaxNode | null = item; n; n = n.parent) {
              if (n.name === "ListItem") depth++;
              else if (n.name === "BulletList") bulletDepth++;
            }

            const first = doc.lineAt(mark.from);
            if (first.from >= visible.from) {
              const task = item.getChild("Task")?.getChild("TaskMarker");
              const from = indentFrom(first.from, mark.from);
              let to = (task ?? mark).to;
              while (to < first.to && /[ \t]/.test(doc.sliceString(to, to + 1))) to++;

              // Every item but a top-level list's first sits a little apart.
              const above = first.number > 1 ? doc.line(first.number - 1).text : "";
              const gap =
                (item.prevSibling?.name === "ListItem" || depth > 1) && !/^[\s>]*$/.test(above);
              const ordered = item.parent?.name === "OrderedList";
              decorations.push(
                listLine(depth, true, gap).range(first.from),
                (ordered ? ORDERED_PREFIX : PREFIX).range(from, to),
              );

              if (!revealed(from, to)) {
                const plain = PLAIN_BULLET.test(doc.sliceString(mark.from, mark.to));
                if (task) {
                  // A checkbox takes the bullet's place.
                  if (plain) conceal(mark.from, mark.to);
                  const checked =
                    doc.sliceString(task.from, task.to).toLowerCase() !== "[ ]";
                  conceal(task.from, task.to, checked ? CHECKED : UNCHECKED);
                } else if (plain) {
                  conceal(mark.from, mark.to, BULLETS[Math.min(bulletDepth, BULLETS.length) - 1]);
                }
              }
            }

            // Later lines of the item's own paragraphs line up with its text.
            // Nested lists and code blocks lay themselves out.
            for (let child = item.firstChild; child; child = child.nextSibling) {
              if (child.name !== "Paragraph" && child.name !== "Task") continue;
              const start = doc.lineAt(Math.max(child.from, visible.from)).number;
              const end = doc.lineAt(Math.min(child.to, visible.to)).number;
              for (let n = Math.max(start, first.number + 1); n <= end; n++) {
                const line = doc.line(n);
                const text = line.from + /^[\s>]*/.exec(line.text)![0].length;
                const from = indentFrom(line.from, text);
                decorations.push(listLine(depth, from < text).range(line.from));
                if (from < text) decorations.push(PREFIX.range(from, text));
              }
            }
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
