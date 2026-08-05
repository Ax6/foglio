//! Table editing aids.
//!
//! Hand-writing Markdown tables is tedious because the pipes have to be padded
//! by hand to stay readable. Rather than ask that of the writer, cells are typed
//! loosely and realigned automatically once the caret leaves the table — so the
//! source stays tidy without anyone maintaining it.

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Prec, type ChangeSpec, type EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

export interface TableRange {
  from: number;
  to: number;
}

/** The `Table` node containing `pos`, or null. */
function tableAt(state: EditorState, pos: number): TableRange | null {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node.parent) {
    if (node.name === "Table") return { from: node.from, to: node.to };
    node = node.parent;
  }
  // resolveInner at a line start can land outside the table; retry leaning right.
  node = syntaxTree(state).resolveInner(pos, 1);
  while (node.parent) {
    if (node.name === "Table") return { from: node.from, to: node.to };
    node = node.parent;
  }
  return null;
}

/**
 * Split a row into cell texts. Pipes escaped as `\|` belong to the cell, so the
 * split has to respect the backslash rather than using a plain split.
 */
function splitCells(row: string): { indent: string; cells: string[] } {
  const indent = row.match(/^\s*/)?.[0] ?? "";
  let rest = row.slice(indent.length);
  if (rest.startsWith("|")) rest = rest.slice(1);
  if (/(^|[^\\])\|$/.test(rest)) rest = rest.replace(/\|$/, "");

  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "\\" && rest[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return { indent, cells };
}

const DELIMITER_ROW = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

type Align = "left" | "right" | "center" | "none";

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

/**
 * Width as the terminal-ish rendering sees it. Astral characters count as one
 * code point rather than two UTF-16 units, and East Asian wide ranges as two
 * columns, so padding does not drift on non-Latin text.
 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x300 && c <= 0x36f) continue; // combining marks occupy no column
    w +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0x1f300 && c <= 0x1faff)
        ? 2
        : 1;
  }
  return w;
}

function pad(s: string, width: number, align: Align): string {
  const gap = Math.max(0, width - displayWidth(s));
  if (align === "right") return " ".repeat(gap) + s;
  if (align === "center") {
    const l = Math.floor(gap / 2);
    return " ".repeat(l) + s + " ".repeat(gap - l);
  }
  return s + " ".repeat(gap);
}

/**
 * Realign a table's pipes. Returns null when the text is already aligned, so an
 * unchanged table never produces a transaction.
 */
export function formatTable(state: EditorState, range: TableRange): ChangeSpec | null {
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const rows: string[] = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    rows.push(state.doc.line(n).text);
  }
  if (rows.length < 2) return null;

  const parsed = rows.map(splitCells);
  const delimiterIndex = rows.findIndex((r) => DELIMITER_ROW.test(r));
  if (delimiterIndex < 0) return null;

  const columns = Math.max(...parsed.map((p) => p.cells.length));
  const aligns: Align[] = [];
  for (let c = 0; c < columns; c++) {
    aligns.push(alignOf(parsed[delimiterIndex].cells[c] ?? ""));
  }

  // Column width is driven by content only; the delimiter row stretches to fit.
  const widths = new Array(columns).fill(0);
  parsed.forEach((p, i) => {
    if (i === delimiterIndex) return;
    for (let c = 0; c < columns; c++) {
      widths[c] = Math.max(widths[c], displayWidth(p.cells[c] ?? ""));
    }
  });
  for (let c = 0; c < columns; c++) {
    // ':---:' needs three dashes plus its colons to stay valid.
    const min = aligns[c] === "center" ? 5 : aligns[c] === "none" ? 3 : 4;
    widths[c] = Math.max(widths[c], min);
  }

  const indent = parsed[0].indent;
  const out = parsed.map((p, i) => {
    if (i === delimiterIndex) {
      const cells = aligns.map((a, c) => {
        const inner = widths[c];
        if (a === "center") return `:${"-".repeat(inner - 2)}:`;
        if (a === "right") return `${"-".repeat(inner - 1)}:`;
        if (a === "left") return `:${"-".repeat(inner - 1)}`;
        return "-".repeat(inner);
      });
      return `${indent}| ${cells.join(" | ")} |`;
    }
    const cells = aligns.map((a, c) => pad(p.cells[c] ?? "", widths[c], a));
    return `${indent}| ${cells.join(" | ")} |`;
  });

  const insert = out.join(state.lineBreak);
  const current = state.doc.sliceString(startLine.from, endLine.to);
  if (insert === current) return null;
  return { from: startLine.from, to: endLine.to, insert };
}

/**
 * Realign a table once the caret leaves it. Reformatting while the caret is
 * still inside would fight the typist — padding would shift under the cursor on
 * every keystroke.
 */
const alignOnLeave = EditorView.updateListener.of((update) => {
  if (!update.docChanged && !update.selectionSet) return;

  const before = tableAt(update.startState, update.startState.selection.main.head);
  if (!before) return;
  const after = tableAt(update.state, update.state.selection.main.head);
  if (after && after.from === update.changes.mapPos(before.from)) return;

  // The old table's position has to be mapped through this update's changes.
  const from = update.changes.mapPos(before.from, 1);
  const to = update.changes.mapPos(before.to, -1);
  if (from >= to || to > update.state.doc.length) return;

  const still = tableAt(update.state, from);
  if (!still) return;
  const changes = formatTable(update.state, still);
  if (!changes) return;

  // Dispatching synchronously inside an update listener is not allowed.
  const view = update.view;
  Promise.resolve().then(() => {
    if (!view.dom.isConnected) return;
    view.dispatch({ changes, scrollIntoView: false });
  });
});

/** Cell boundaries on a line, as content ranges between the pipes. */
function cellRanges(state: EditorState, pos: number): { from: number; to: number }[] | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  const bounds: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "|" && text[i - 1] !== "\\") bounds.push(i);
  }
  if (bounds.length < 2) return null;
  const ranges: { from: number; to: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    ranges.push({ from: line.from + bounds[i] + 1, to: line.from + bounds[i + 1] });
  }
  return ranges;
}

/** Move the caret one cell forward or back, wrapping across rows. */
function moveCell(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  if (!tableAt(state, head)) return false;

  const ranges = cellRanges(state, head);
  if (!ranges) return false;
  const index = ranges.findIndex((r) => head >= r.from && head <= r.to);
  const next = index + dir;

  const place = (range: { from: number; to: number }) => {
    // Land on the cell's text, not on its padding.
    const text = state.doc.sliceString(range.from, range.to);
    const lead = text.length - text.trimStart().length;
    const anchor = range.from + lead;
    const headPos = range.to - (text.length - text.trimEnd().length);
    view.dispatch({
      selection: EditorSelection.range(anchor, Math.max(anchor, headPos)),
      scrollIntoView: true,
    });
    return true;
  };

  if (next >= 0 && next < ranges.length) return place(ranges[next]);

  // Past either end of the row: step to the adjacent row, skipping the
  // delimiter, and enter it from the corresponding side.
  const line = state.doc.lineAt(head);
  let n = line.number + dir;
  while (n >= 1 && n <= state.doc.lines) {
    const candidate = state.doc.line(n);
    if (!candidate.text.includes("|")) return false;
    if (!DELIMITER_ROW.test(candidate.text)) {
      const rs = cellRanges(state, candidate.from);
      if (!rs) return false;
      return place(dir === 1 ? rs[0] : rs[rs.length - 1]);
    }
    n += dir;
  }
  return false;
}

/**
 * Tab moves between cells inside a table and falls through to indentation
 * elsewhere, so the binding has to sit above the default keymap.
 */
export const tableEditing = [
  alignOnLeave,
  Prec.high(
    keymap.of([
      { key: "Tab", run: (view) => moveCell(view, 1) },
      { key: "Shift-Tab", run: (view) => moveCell(view, -1) },
    ]),
  ),
];
