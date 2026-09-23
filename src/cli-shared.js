// Shared CLI helpers used by src/cli.js and the command modules in src/commands/.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

export function writeJson(path, obj) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export function toPort(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error('--port must be an integer between 0 and 65535');
  }
  return n;
}
