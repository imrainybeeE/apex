// Load game scripts into a Node vm with stubbed browser APIs and report any throw.
// Usage: node tools/stubcheck.mjs js/config.js js/eco.js [--eval "code run after load"]
// The eval result is printed (JSON when possible). Exit code 1 on any error.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

function makeStub() {
  const cache = new Map();
  const target = function () {};
  return new Proxy(target, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return (hint) => (hint === 'string' ? '' : 0);
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      if (cache.has(k)) return cache.get(k);
      const s = makeStub();
      cache.set(k, s);
      return s;
    },
    set(t, k, v) { cache.set(k, v); return true; },
    apply() { return makeStub(); },
    construct() { return makeStub(); },
  });
}

const args = process.argv.slice(2);
const evalIdx = args.indexOf('--eval');
const evalCode = evalIdx >= 0 ? args[evalIdx + 1] : null;
const files = (evalIdx >= 0 ? args.slice(0, evalIdx).concat(args.slice(evalIdx + 2)) : args);

const store = new Map();
const sandbox = {
  console, Math, JSON, Date,
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone,
  URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa,
  performance: { now: () => performance.now() },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  location: { search: '', href: 'file:///apex/index.html', protocol: 'file:' },
  navigator: { userAgent: 'node-stubcheck', maxTouchPoints: 0 },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  fetch: () => Promise.reject(new Error('fetch disabled in stubcheck')),
  document: makeStub(), Image: makeStub(), Audio: makeStub(), AudioContext: makeStub(),
  webkitAudioContext: makeStub(), OffscreenCanvas: makeStub(), Path2D: makeStub(),
  addEventListener() {}, removeEventListener() {},
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let failed = false;
for (const f of files) {
  try {
    vm.runInContext(fs.readFileSync(path.resolve(f), 'utf8'), sandbox, { filename: f });
    console.log(`ok   ${f}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${f}\n${e.stack}`);
  }
}
const A = sandbox.Apex;
console.log('Apex keys:', A ? Object.keys(A).join(', ') : '(window.Apex missing)');
if (evalCode && !failed) {
  try {
    const r = vm.runInContext(evalCode, sandbox, { filename: '--eval' });
    let out;
    try { out = JSON.stringify(r, null, 2); } catch { out = String(r); }
    console.log('eval:', out);
  } catch (e) {
    failed = true;
    console.log(`FAIL --eval\n${e.stack}`);
  }
}
process.exit(failed ? 1 : 0);
