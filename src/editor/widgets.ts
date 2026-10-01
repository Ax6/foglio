import { EditorView, WidgetType } from "@codemirror/view";

const TASK_LEN = 3; // "[ ]"

/** A real checkbox standing in for `[ ]` / `[x]`. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-md-task";
    box.checked = this.checked;
    box.tabIndex = -1;

    // The position is read from the DOM at click time rather than captured in
    // the widget, so a reused widget can never toggle a stale offset.
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const pos = view.posAtDOM(box);
      const marker = view.state.sliceDoc(pos, pos + TASK_LEN);
      if (!/^\[[ xX]\]$/.test(marker)) return;
      view.dispatch({
        changes: {
          from: pos,
          to: pos + TASK_LEN,
          insert: marker[1] === " " ? "[x]" : "[ ]",
        },
      });
    });

    return box;
  }

  ignoreEvent() {
    return true;
  }
}

export class BulletWidget extends WidgetType {
  constructor(readonly glyph: string) {
    super();
  }

  eq(other: BulletWidget) {
    return other.glyph === this.glyph;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-bullet";
    el.textContent = this.glyph;
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

/** A fenced block's language, standing in for its concealed opening fence. */
export class FenceLabelWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }

  eq(other: FenceLabelWidget) {
    return other.lang === this.lang;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-fence-label";
    el.textContent = this.lang;
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

export class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-md-rule";
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  ignoreEvent() {
    return false;
  }
}
