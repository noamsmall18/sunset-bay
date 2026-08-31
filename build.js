#!/usr/bin/env node
// build.js - inline every source module into a single self-contained HTML file
// suitable for publishing. Dev (index.html) and the shipped build run the exact
// same code; only the script tags differ.
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist', 'sunset-bay.html');
const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.1/three.min.js';

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
if (!files.length) { console.error('no source files'); process.exit(1); }

const shell = fs.readFileSync(path.join(ROOT, 'shell.html'), 'utf8');

let bundle = '';
let totalRaw = 0;
for (const f of files) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  totalRaw += code.length;
  bundle += `\n/* ===== ${f} ===== */\n${code}\n`;
}

// A script tag must never contain a literal </script>; nothing in the sources
// does, but guard anyway so a future string cannot silently break the build.
if (/<\/script/i.test(bundle)) {
  console.error('source contains a literal </script>, which would break the inline bundle');
  process.exit(1);
}

// NOTE: the replacement MUST be a function. With a string replacement, `$'`
// and friends are treated as substitution patterns, and the sources contain
// `'-$'` (in formatMoney), which silently truncates the inlined bundle.
const html = shell
  .replace('<!--THREE-->', () => `<script src="${THREE_CDN}"></script>`)
  .replace('<!--BUNDLE-->', () => `<script>\n${bundle}\n</script>`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);

// Dev page: same shell, but scripts stay separate so stack traces point at the
// real file and line. Uses a vendored three so it works offline.
const stamp = Date.now();
const devScripts = ['vendor/three.min.js', ...files.map(f => 'src/' + f)]
  .map(s => `<script src="${s}?v=${stamp}"></script>`).join('\n');
const dev = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
  shell.replace('<!--THREE-->', () => '').replace('<!--BUNDLE-->', () => devScripts) +
  '\n</html>\n';
fs.writeFileSync(path.join(ROOT, 'index.html'), dev);

// Sanity check: every module must survive into the page intact. This caught a
// real bug once already, so it stays.
const markers = (html.match(/\/\* ===== /g) || []).length;
if (markers !== files.length) {
  console.error(`only ${markers} of ${files.length} modules made it into the page`);
  process.exit(1);
}
if (html.length < bundle.length) {
  console.error(`page is ${html.length}B but the bundle alone is ${bundle.length}B - the build mangled it`);
  process.exit(1);
}

const kb = n => (n / 1024).toFixed(1) + 'KB';
console.log(`built ${OUT}`);
console.log(`  ${files.length} modules, ${kb(totalRaw)} of source -> ${kb(html.length)} page`);
for (const f of files) {
  const s = fs.statSync(path.join(SRC, f)).size;
  console.log(`    ${f.padEnd(22)} ${kb(s).padStart(9)}`);
}
