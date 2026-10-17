// Loads the user's original files by DOS name (case-insensitive) from the Vite dev server's game folder or a
// user-selected folder. Nothing is cached outside the page and nothing is written back.
export function assetSource(entries) {
  const byName = new Map(entries.map(entry => [entry.path.replaceAll('\\', '/').toLowerCase(), entry]));
  return {
    has: name => byName.has(name.replaceAll('\\', '/').toLowerCase()),
    async read(name) {
      const entry = byName.get(name.replaceAll('\\', '/').toLowerCase());
      if (!entry) throw new Error(`Missing original file ${name}. Select the Alien Breed game folder itself.`);
      if (entry.file) return new Uint8Array(await entry.file.arrayBuffer());
      const response = await fetch(`./game/${entry.path.split('/').map(encodeURIComponent).join('/')}`);
      if (!response.ok) throw new Error(`Could not read ${entry.path} (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

// Folder input: strip the selected folder's own name so paths are relative to the game folder.
export const entriesFromFileList = files => [...files].map(file => ({ path: file.webkitRelativePath.split('/').slice(1).join('/'), file }));
