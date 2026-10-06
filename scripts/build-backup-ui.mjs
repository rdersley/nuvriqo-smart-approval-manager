// Builds the Backup & restore admin page (static/backup) into static/backup/build for Forge.
// It is a small Custom UI page because UI Kit cannot hand the browser a file to save.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const dir = new URL('../static/backup/', import.meta.url);
mkdirSync(new URL('build/', dir), { recursive: true });
await build({
  entryPoints: [new URL('src/main.js', dir).pathname],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  outfile: new URL('build/main.js', dir).pathname,
  logLevel: 'warning'
});
for (const file of ['index.html', 'styles.css']) copyFileSync(new URL(file, dir), new URL(`build/${file}`, dir));
console.log('Built static/backup/build');
