/**
 * Build step: emit a CommonJS bundle of the ESM SDK source.
 *
 * Usage: node scripts/build.cjs
 * Output: dist/cjs/index.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'index.js');
const OUT = path.join(ROOT, 'dist', 'cjs', 'index.cjs');

const source = fs.readFileSync(SRC, 'utf8');

const checks = [
  [/export\s+default\s+GennetSMS\s*;/, 'export default'],
  [/export\s*\{\s*GennetSMS\s*,\s*GennetSMSError\s*\}\s*;/, 'named exports'],
];
for (const [pattern, label] of checks) {
  if (!pattern.test(source)) {
    throw new Error(`scripts/build.cjs: expected ${label} in src/index.js — update the transform.`);
  }
}

const cjs = source
  .replace(/export\s+default\s+GennetSMS\s*;/, 'module.exports = GennetSMS;')
  .replace(
    /export\s*\{\s*GennetSMS\s*,\s*GennetSMSError\s*\}\s*;/,
    'module.exports.GennetSMS = GennetSMS;\nmodule.exports.GennetSMSError = GennetSMSError;',
  );

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `"use strict";\n\n${cjs}`, 'utf8');

process.stdout.write(`built ${path.relative(ROOT, OUT)}\n`);
