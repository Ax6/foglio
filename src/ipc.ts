import { invoke } from "@tauri-apps/api/core";

export interface Doc {
  path: string | null;
  content: string;
  mtime: number | null;
}

export interface Saved {
  path: string;
  mtime: number | null;
}

/** The document this window was created for. Pulled, never pushed — see lib.rs. */
export const bootstrap = () => invoke<Doc>("bootstrap");

/** Reveal the window; it is built hidden to avoid an unpainted flash. */
export const ready = () => invoke<void>("ready");

export const readFile = (path: string) => invoke<Doc>("read_file", { path });

export const saveFile = (path: string, content: string) =>
  invoke<Saved>("save_file", { path, content });

export const setDirty = (dirty: boolean) => invoke<void>("set_dirty", { dirty });

export const openPath = (path: string) => invoke<void>("open_path", { path });

export const newWindow = () => invoke<void>("new_window");

export const statMtime = (path: string) => invoke<number | null>("stat_mtime", { path });

export const forceClose = () => invoke<void>("force_close");
