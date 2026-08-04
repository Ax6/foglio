export type SaveChoice = "save" | "discard" | "cancel";

/**
 * The plugin-dialog confirm only offers two buttons, and closing an edited
 * document genuinely needs three, so this is a native <dialog>.
 */
export function askToSave(name: string): Promise<SaveChoice> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "prompt";
    dialog.innerHTML = `
      <p class="prompt-title">Save changes to “${escapeHtml(name)}” before closing?</p>
      <p class="prompt-body">Your changes will be lost if you don’t save them.</p>
      <div class="prompt-actions">
        <button value="discard" class="ghost">Don’t Save</button>
        <span class="spacer"></span>
        <button value="cancel" class="ghost">Cancel</button>
        <button value="save" class="primary" autofocus>Save</button>
      </div>
    `;

    let settled = false;
    const finish = (choice: SaveChoice) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(choice);
    };

    dialog.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (button) finish(button.value as SaveChoice);
    });
    // Escape closes without committing to anything.
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("cancel");
    });

    document.body.append(dialog);
    dialog.showModal();
  });
}

function escapeHtml(value: string) {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

let bannerTimer: number | undefined;

export function showBanner(text: string, sticky = false) {
  const banner = document.getElementById("banner");
  if (!banner) return;
  banner.textContent = text;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  if (!sticky) {
    bannerTimer = window.setTimeout(() => {
      banner.hidden = true;
    }, 3200);
  }
}
