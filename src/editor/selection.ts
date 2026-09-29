//! Selection highlight.
//!
//! CodeMirror's own selection layer stretches a highlight to the edges of the
//! content box. Here that box fills the window, because each line centres
//! itself with margins, so the highlight would bleed across both margins. This
//! layer draws the same rectangles clipped to the boxes of the lines they
//! cross, which keeps a highlight inside the text column and lets it follow a
//! wide table past it.
//!
//! The layer sits beneath the text, so anything drawn over it must have a
//! translucent background (see --code-bg in styles.css).

import { RectangleMarker, layer, type EditorView } from "@codemirror/view";

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const CLASS = "cm-md-selection";

/** Every drawn line and block widget, in the layer's coordinates. */
function lineBoxes(view: EditorView): Box[] {
  const scroller = view.scrollDOM.getBoundingClientRect();
  const baseLeft = scroller.left - view.scrollDOM.scrollLeft;
  const baseTop = scroller.top - view.scrollDOM.scrollTop;

  const boxes: Box[] = [];
  for (const el of view.contentDOM.children) {
    const table = el.classList.contains("cm-md-table");
    if (!table && !el.classList.contains("cm-line")) continue;

    // A rendered table's root spans the window. Its visible extent is the
    // scroll box inside, but the root's height keeps the highlight unbroken.
    const outer = el.getBoundingClientRect();
    const inner = table ? (el.firstElementChild ?? el).getBoundingClientRect() : outer;
    boxes.push({
      left: inner.left - baseLeft,
      right: inner.right - baseLeft,
      top: outer.top - baseTop,
      bottom: outer.bottom - baseTop,
    });
  }
  return boxes;
}

export const selectionLayer = layer({
  above: false,
  class: "cm-md-selectionLayer",
  update: (update) => update.docChanged || update.selectionSet || update.viewportChanged,
  markers(view) {
    const ranges = view.state.selection.ranges.filter((r) => !r.empty);
    if (!ranges.length) return [];

    const boxes = lineBoxes(view);
    const markers: RectangleMarker[] = [];
    for (const range of ranges) {
      for (const m of RectangleMarker.forRange(view, CLASS, range)) {
        const right = m.left + (m.width ?? 0);
        const bottom = m.top + m.height;
        for (const box of boxes) {
          if (box.bottom <= m.top) continue;
          if (box.top >= bottom) break;
          const l = Math.max(m.left, box.left);
          const r = Math.min(right, box.right);
          const t = Math.max(m.top, box.top);
          const b = Math.min(bottom, box.bottom);
          if (r > l && b > t) markers.push(new RectangleMarker(CLASS, l, t, r - l, b - t));
        }
      }
    }
    return markers;
  },
});
