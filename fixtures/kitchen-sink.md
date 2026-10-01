# foglio kitchen sink

A fixture that exercises every element the v1 renderer handles. Put the caret
on any line to see its raw markdown reappear.

## Emphasis

Plain text with **bold**, *italic*, ***both at once***, ~~struck through~~, and
`inline code` mixed into a sentence. Nested **bold with *italic* inside** too.

### Smaller heading

#### Fourth level

##### Fifth level

###### Sixth level

## Lists

- A plain bullet
- Another bullet
  - Nested one level
  - And a sibling
* A star bullet
+ A plus bullet

1. First ordered item
2. Second ordered item
3. Third ordered item

- State lives on the [app-flood project](https://example.com). Its Status field
  runs Idea → Building → Review → Approved → Submitted → Live, or Rejected. Read and change it with `.flood/bin/state`.
- `.flood/bin/notify` pushes a message to the owner's phone. It reads its token from `~/.config/app-flood/env`.
  - A nested item long enough to wrap onto a second line, so its continuation lines up under its own text.

9. An ordered item just short of two digits
10. A two-digit sibling, whose text still lines up with the item above when it wraps onto a second line.

## Tasks

- [ ] Unchecked task
- [x] Checked task
- [ ] Task with **bold** and `code`
  - [x] Nested checked task

## Links

An [inline link](https://example.com) and a [relative one](./other.md).
A bare autolink: <https://codemirror.net>. An image stays raw in v1:
![alt text](./diagram.png).

## Blockquote

> A single-line quote.
>
> A second paragraph inside the same quote, with **bold** text.
>
> > And a nested quote inside it.

## Rule

---

## Code

Inline `const x = 1` versus a fenced block:

```rust
fn main() {
    // A comment
    let greeting = "hello";
    let count: u32 = 42;
    println!("{greeting} {count}");
}
```

```typescript
interface Doc {
  path: string | null;
  content: string;
}

export function load(doc: Doc): boolean {
  return doc.content.length > 0;
}
```

```
A fence with no language at all.
```

## Table

| Element | Rendered | Notes |
| ------- | -------- | ----- |
| Heading | yes | scaled by level |
| Table | laid out | source on click |
| Image | no | v1 leaves raw |

A wide table, with inline markup, alignment, an empty cell and an escaped pipe:

| Module | Role | Hot path | Notes |
| :--- | :--- | :---: | ---: |
| `live-preview.ts` | Conceals and reveals Markdown syntax as the caret moves | yes | Only walks the lines on screen, so document size barely affects typing cost |
| `table-view.ts` | Renders tables as **laid-out tables** until the caret enters one | no | Parses each table on its own, and only once it scrolls into view |
| `tables.ts` | Realigns pipes when the caret leaves a table | | Honours `:---:` and `---:` markers; `a \| b` stays in one cell |
| [`windows.rs`](./src-tauri/src/windows.rs) | The single funnel every file-open route leads into | no | *Rust side* |

## Long paragraph

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
fugiat nulla pariatur.
