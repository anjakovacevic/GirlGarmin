/** Where the app keeps its files: JSON documents under one folder in the app's private storage
 * (only this app can read it; uninstalling the app deletes it). The interface is small so the same
 * sync / analysis code can also run under Node for testing (scripts/compare.ts). */

export interface Store {
  /** Parsed JSON at `path` ("raw/activities.json"), or null if the file doesn't exist. */
  read<T = any>(path: string): Promise<T | null>;
  write(path: string, obj: unknown): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** File names (not paths) directly inside `dir`; [] if it doesn't exist. */
  list(dir: string): Promise<string[]>;
  /** Delete a file or a whole folder. */
  remove(path: string): Promise<void>;
}

let current: Store | null = null;

export function setStore(s: Store): void {
  current = s;
}

export function store(): Store {
  if (!current) throw new Error('Storage not initialised');
  return current;
}
