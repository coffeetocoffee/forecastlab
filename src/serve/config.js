/**
 * Server configuration constants.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PACKAGE_JSON = new URL('../../package.json', import.meta.url);
const VERSION = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version;

export { VERSION };
