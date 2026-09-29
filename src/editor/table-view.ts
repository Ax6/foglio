//! Rendered tables.
//!
//! A table shows as a laid-out table while the caret is elsewhere, and as its
//! Markdown source while the caret is inside it, where tables.ts keeps the pipes
//! aligned. Block widgets change the editor's vertical layout, so they have to
//! come from a state field rather than from the live-preview view plugin.

import { markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Range,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";

import { alignOf, splitCells, type Align } from "./tables";

interface Span {
  from: number;
  to: number;
}

/** Blocks a renderable table can sit in. Anything else is skipped unvisited. */
const CONTAINERS = new Set(["Document", "BulletList", "OrderedList", "ListItem"]);

/**
 * Whole-line spans of the tables in `from`–`to`, appended to `out`. A table
 * indented four or more spaces would parse as code once cut out of its list,
 * so it stays as source.
 */
function scan(state: EditorState, from: number, to: number, out: Span[]) {
  const doc = state.doc;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "Table") return CONTAINERS.has(node.name);
      const first = doc.lineAt(node.from);
      const indent = doc.sliceString(first.from, node.from);
      if (indent.length < 4 && !indent.trim()) {
        out.push({ from: first.from, to: doc.lineAt(node.to).to });
      }
      return false;
    },
  });
}

function scanAll(state: EditorState): Span[] {
  const spans: Span[] = [];
  scan(state, 0, state.doc.length, spans);
  return spans;
}

/**
 * Carry the spans across an edit by rescanning only the edited lines, plus one
 * line either side, since a row typed next to a table joins it.
 */
function rescanEdited(spans: Span[], tr: Transaction): Span[] {
  const { changes, state } = tr;
  const doc = state.doc;
  const found: Span[] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const first = doc.line(Math.max(1, doc.lineAt(fromB).number - 1));
    const last = doc.line(Math.min(doc.lines, doc.lineAt(toB).number + 1));
    scan(state, first.from, last.to, found);
  });

  const kept: Span[] = [];
  for (const s of spans) {
    if (changes.touchesRange(s.from, s.to)) continue;
    const span = { from: changes.mapPos(s.from), to: changes.mapPos(s.to) };
    if (!found.some((f) => f.from <= span.to && f.to >= span.from)) kept.push(span);
  }
  // Neighbouring edits can find the same table twice.
  return kept
    .concat(found)
    .sort((a, b) => a.from - b.from)
    .filter((s, i, all) => i === 0 || s.from !== all[i - 1].from);
}

function decorate(state: EditorState, spans: Span[]): DecorationSet {
  const { ranges } = state.selection;
  const widgets: Range<Decoration>[] = [];
  for (const { from, to } of spans) {
    if (ranges.some((r) => r.from <= to && r.to >= from)) continue;
    const widget = new TableWidget(state.doc.sliceString(from, to));
    widgets.push(Decoration.replace({ widget, block: true }).range(from, to));
  }
  return Decoration.set(widgets);
}

interface Tables {
  spans: Span[];
  decorations: DecorationSet;
}

const rescan = StateEffect.define<null>();

/**
 * An edit rescans only the lines it touched, so typing costs the same in any
 * size of document. That misses edits whose effect reaches further, such as an
 * unclosed code fence swallowing the tables below it, so a full scan follows
 * once typing or background parsing pauses.
 */
const tables = StateField.define<Tables>({
  create(state) {
    const spans = scanAll(state);
    return { spans, decorations: decorate(state, spans) };
  },
  update(value, tr) {
    let spans = value.spans;
    if (tr.effects.some((e) => e.is(rescan))) spans = scanAll(tr.state);
    else if (tr.docChanged) spans = rescanEdited(spans, tr);
    else if (!tr.selection) return value;
    return { spans, decorations: decorate(tr.state, spans) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const RESCAN_DELAY_MS = 300;

const rescanWhenIdle = ViewPlugin.fromClass(
  class {
    timer: number | undefined;

    constructor(readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged && syntaxTree(update.state) === syntaxTree(update.startState)) {
        return;
      }
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.view.dispatch({ effects: rescan.of(null) });
      }, RESCAN_DELAY_MS);
    }

    destroy() {
      clearTimeout(this.timer);
    }
  },
);

/**
 * Vertical motion skips over block widgets, so a rendered table would be
 * unreachable from the keyboard. Stepping onto one lands on its nearest row,
 * which reveals the source.
 */
function enterTable(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty) return false;
  const n = state.doc.lineAt(main.head).number + dir;
  if (n < 1 || n > state.doc.lines) return false;
  const next = state.doc.line(n);
  const { spans } = state.field(tables);
  const onto =
    dir > 0 ? spans.some((s) => s.from === next.from) : spans.some((s) => s.to === next.to);
  if (!onto) return false;
  view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true });
  return true;
}

export const renderedTables = [
  tables,
  rescanWhenIdle,
  Prec.high(
    keymap.of([
      { key: "ArrowDown", run: (view) => enterTable(view, 1) },
      { key: "ArrowUp", run: (view) => enterTable(view, -1) },
    ]),
  ),
];

/**
 * The source position behind an element of a rendered table. Elements carry
 * their offset from the start of the table, and the widget's own position is
 * read at event time, so a reused widget never reports a stale position.
 */
export function tableSourcePos(view: EditorView, target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const at = target.closest<HTMLElement>("[data-offset]");
  const root = at?.closest(".cm-md-table");
  if (!at || !root) return null;
  return view.posAtDOM(root) + Number(at.dataset.offset);
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: TableWidget) {
    return other.source === this.source;
  }

  /** Close enough that the height map barely moves when the table is drawn. */
  get estimatedHeight() {
    const rows = this.source.split("\n").length - 1;
    return rows * 32 + 12;
  }

  toDOM(view: EditorView) {
    const root = document.createElement("div");
    root.className = "cm-md-table";
    const scroll = root.appendChild(document.createElement("div"));
    scroll.className = "cm-md-table-scroll";
    scroll.appendChild(renderTable(this.source));

    // A click in a cell moves the caret there, which swaps in the source.
    // Clicks elsewhere, such as on the scrollbar, are left alone.
    root.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.metaKey) return;
      const pos = tableSourcePos(view, event.target);
      if (pos == null) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });

    return root;
  }

  // Cmd-click goes through to the editor, where links.ts follows the link.
  ignoreEvent(event: Event) {
    return !(event instanceof MouseEvent && event.metaKey);
  }
}

function findTable(tree: Tree): SyntaxNode | null {
  const cursor = tree.cursor();
  do {
    if (cursor.name === "Table") return cursor.node;
  } while (cursor.next());
  return null;
}

/**
 * The table is parsed on its own, so rendering needs nothing from the editor
 * and runs only for tables that scroll into view.
 */
function renderTable(source: string): HTMLTableElement {
  const table = document.createElement("table");
  const node = findTable(markdownLanguage.parser.parse(source));
  if (!node) return table;

  const delimiter = node.getChild("TableDelimiter");
  const aligns: Align[] = delimiter
    ? splitCells(source.slice(delimiter.from, delimiter.to)).cells.map(alignOf)
    : [];

  const head = table.createTHead();
  const body = table.createTBody();
  let columns = 0;

  for (let row = node.firstChild; row; row = row.nextSibling) {
    const header = row.name === "TableHeader";
    if (!header && row.name !== "TableRow") continue;

    // The header fixes the column count. Short rows are padded and long rows
    // cut, as GFM does.
    const cells = rowCells(row, source);
    if (header) columns = cells.length;
    const tr = (header ? head : body).insertRow();

    for (let c = 0; c < columns; c++) {
      const cell = cells[c];
      const el = tr.appendChild(document.createElement(header ? "th" : "td"));
      const align = aligns[c];
      if (align && align !== "none") el.style.textAlign = align;
      el.dataset.offset = String(cell ? cell.offset : row.to);
      if (cell?.node) renderInline(cell.node, source, el);
    }
  }

  return table;
}

interface Cell {
  offset: number;
  node: SyntaxNode | null;
}

/**
 * A row's cells, counted between its pipes. An empty cell has no TableCell
 * node, so the pipes are the only reliable column count.
 */
function rowCells(row: SyntaxNode, source: string): Cell[] {
  const pipes = row.getChildren("TableDelimiter");
  const contents = row.getChildren("TableCell");
  const edges = [row.from, ...pipes.flatMap((p) => [p.from, p.to]), row.to];

  const cells: Cell[] = [];
  for (let i = 0; i < edges.length; i += 2) {
    const from = edges[i];
    const to = edges[i + 1];
    const node = contents.find((n) => n.from >= from && n.to <= to) ?? null;

    // Blank space outside the leading or trailing pipe is not a cell.
    const outer = i === 0 || i === edges.length - 2;
    if (outer && !node && !source.slice(from, to).trim()) continue;

    const offset = node ? node.from : Math.min(from + 1, to);
    cells.push({ offset, node });
  }
  return cells;
}

const INLINE: Record<string, [tag: string, className: string]> = {
  StrongEmphasis: ["strong", "md-strong"],
  Emphasis: ["em", "md-em"],
  Strikethrough: ["s", "md-strike"],
  InlineCode: ["code", "cm-md-inline-code md-mono"],
  Link: ["a", "md-link"],
  Autolink: ["a", "md-link"],
};

/** Syntax the rendered form drops. A Link's URL is dropped separately. */
const MARKS = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "LinkTitle",
  "LinkLabel",
]);

/**
 * Inline Markdown inside a cell. Anything unlisted, such as an image or raw
 * HTML, is shown as its source text, the same as in prose.
 */
function renderInline(node: SyntaxNode, source: string, into: HTMLElement) {
  // GFM lets `\|` stand for a pipe even inside a code span.
  const text = (from: number, to: number) => {
    const s = source.slice(from, to);
    return node.name === "InlineCode" ? s.replace(/\\\|/g, "|") : s;
  };

  let pos = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    into.append(text(pos, child.from));
    pos = child.to;

    const name = child.name;
    if (MARKS.has(name) || (name === "URL" && node.name === "Link")) continue;
    if (name === "Escape") {
      into.append(source.slice(child.from + 1, child.to));
      continue;
    }

    const spec = INLINE[name];
    if (!spec) {
      into.append(source.slice(child.from, child.to));
      continue;
    }

    const el = document.createElement(spec[0]);
    el.className = spec[1];
    // Points inside the link, where links.ts resolves its target.
    if (spec[0] === "a") el.dataset.offset = String(child.from + 1);
    renderInline(child, source, el);
    into.append(el);
  }
  into.append(text(pos, node.to));
}
