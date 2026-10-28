// Publishes the committed game to GitHub Pages (imrainybeeE/apex-play, https://imrainybeee.github.io/apex-play/).
// Builds dist/apex.html from a clean worktree of HEAD (never from uncommitted edits), adds a noindex meta,
// boots it headless (title, t1, t6; one Chromium launch), then pushes it as index.html to apex-play.
// Usage: node tools/deploy-pages.mjs [--dry]   (--dry: build and check, don't push)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAY_REPO = 'https://github.com/imrainybeeE/apex-play.git';
const dry = process.argv.includes('--dry');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd: cwd || ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-deploy-'));
const clean = path.join(tmp, 'clean'), play = path.join(tmp, 'play');
const head = run('git', ['rev-parse', '--short', 'HEAD']);
const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']);
if (dirty) console.log('note: uncommitted changes are NOT deployed; building ' + head);

try {
  run('git', ['worktree', 'add', '--detach', clean, 'HEAD']);
  console.log(run('node', [path.join(clean, 'tools', 'build-single.mjs')], clean));
  const html = fs.readFileSync(path.join(clean, 'dist', 'apex.html'), 'utf8')
    .replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">');
  const page = path.join(tmp, 'index.html');
  fs.writeFileSync(page, html);

  // boot check
  const errs = []; const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  const url = pathToFileURL(page).href;
  await p.goto(url + '?mute=1'); await p.waitForTimeout(1200);
  const modes = [await p.evaluate(() => Apex.G.mode)];
  for (const t of ['t1_litter', 't6_valley']) {
    await p.goto(url + '?tier=' + t + '&tutorial=0&mute=1&skipEditor=1');
    await p.waitForFunction(() => Apex.G.mode === 'play', null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(1200); modes.push(await p.evaluate(() => Apex.G.mode));
  }
  await b.close();
  console.log('boot: ' + modes.join(', ') + '; pageerrors ' + errs.length);
  if (errs.length || modes.join() !== 'title,play,play') { errs.forEach((e) => console.log('  ' + e)); throw new Error('boot check failed, not deploying'); }

  if (dry) { console.log('dry run: built and checked ' + page); }
  else {
    run('git', ['clone', '--depth', '1', PLAY_REPO, play]);
    fs.copyFileSync(page, path.join(play, 'index.html'));
    fs.writeFileSync(path.join(play, '.nojekyll'), '');
    run('git', ['add', '-A'], play);
    if (!run('git', ['status', '--porcelain'], play)) console.log('page unchanged; nothing to push');
    else {
      run('git', ['commit', '-q', '-m', 'Deploy ' + head], play);
      run('git', ['push', '-q', 'origin', 'HEAD'], play);
      console.log('pushed ' + head + ' -> https://imrainybeee.github.io/apex-play/ (live in about a minute)');
    }
  }
} finally {
  try { run('git', ['worktree', 'remove', '--force', clean]); } catch (e) { /* worktree may not exist */ }
  if (!dry) fs.rmSync(tmp, { recursive: true, force: true });
}
