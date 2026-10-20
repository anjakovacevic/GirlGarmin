import { Directory, File, Paths } from 'expo-file-system';

import type { Store } from './store';

/** Store backed by the app's private documents folder (Paths.document/girlgarmin). */
export function expoStore(): Store {
  const root = new Directory(Paths.document, 'girlgarmin');
  const file = (path: string) => new File(root, ...path.split('/'));
  const dir = (path: string) => new Directory(root, ...path.split('/'));

  return {
    async read(path) {
      const f = file(path);
      if (!f.exists) return null;
      const text = await f.text();
      return text ? JSON.parse(text) : null;
    },
    async write(path, obj) {
      const f = file(path);
      f.parentDirectory.create({ intermediates: true, idempotent: true });
      if (!f.exists) f.create();
      await f.write(JSON.stringify(obj ?? null));
    },
    async exists(path) {
      return file(path).exists;
    },
    async list(path) {
      const d = dir(path);
      return d.exists ? d.list().filter((x) => x instanceof File).map((x) => x.name) : [];
    },
    async remove(path) {
      const f = file(path);
      if (f.exists) f.delete();
      const d = dir(path);
      if (d.exists) d.delete();
    },
  };
}
