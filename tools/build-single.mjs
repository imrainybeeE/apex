// Builds dist/apex.html: index.html with every local stylesheet and script inlined, so the whole game is one file
// (for Google Sites "Embed code", or to send to playtesters). Missing optional files are skipped.
// Usage: node tools/build-single.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => { const f = path.join(ROOT, rel); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
const skipped = [];

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (m, rel) => {
  const css = read(rel);
  if (css === null) { skipped.push(rel); return ''; }
  return '<style>\n' + css + '\n</style>';
});
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, rel) => {
  const js = read(rel);
  if (js === null) { skipped.push(rel); return ''; }
  return '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>';
});

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'apex.html');
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)` + (skipped.length ? `; skipped missing: ${skipped.join(', ')}` : ''));
