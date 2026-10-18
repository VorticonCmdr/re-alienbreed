import { defineConfig } from 'vite';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
// Only metadata is generated. Original files stay in ignored game/ and never enter dist/.
async function catalog(directory, prefix = '') {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const path = prefix + entry.name, fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await catalog(fullPath, path + '/'));
    else if (entry.isFile()) files.push({ path, size: (await stat(fullPath)).size });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export default defineConfig({
  base: './',
  publicDir: false,
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  plugins: [{
    name: 'local-game-catalog',
    configureServer(server) {
      server.middlewares.use('/__game_catalog', async (request, response, next) => {
        if (request.method !== 'GET' || request.url.split('?')[0] !== '/') return next();
        try {
          response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify(await catalog(resolve(root, 'game'))));
        } catch { response.statusCode = 500; response.end(JSON.stringify({ error: 'Cannot read the local game folder' })); }
      });
    },
  }],
  build: { rolldownOptions: { input: { index: resolve(root, 'index.html'), viewer: resolve(root, 'viewer.html'), game: resolve(root, 'game.html'), level: resolve(root, 'level.html') } } },
});
