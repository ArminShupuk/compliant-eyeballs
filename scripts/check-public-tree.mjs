import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkText } from './package-content.mjs';

let count = 0;
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.idea'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error(`${path}: review symlinks before publication`);
    if (entry.isDirectory()) inspect(path);
    else { checkText(path, readFileSync(path, 'utf8')); count++; }
  }
}
inspect('.');
console.log(`${count} repository files checked for private references, machine paths and credential patterns.`);
