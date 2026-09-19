import { readFileSync, readdirSync } from 'node:fs';

const matrix = readFileSync('docs/PROFILE.md', 'utf8');
const listed = new Set((matrix.match(/<!-- Conformance sections: ([\d, ]+) -->/)?.[1] ?? '').split(',').map(s => s.trim()));
if (!listed.size || listed.has('')) throw new Error('docs/PROFILE.md needs a conformance-section index');
for (const section of listed) {
  if (!new RegExp(`\\|[^\\n]*RFC §§?[^\\n|]*\\b${section}\\b`).test(matrix))
    throw new Error(`RFC §${section} lacks a requirements-matrix row`);
}
const files = ['test', 'fixtures'].flatMap(directory =>
  readdirSync(directory).filter(name => name.endsWith('.test.mjs')).map(name => `${directory}/${name}`));
let definitions = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (/(?<![\w.])(?:test|it)\s*(?:\.(?:skip|only|todo))?\s*\(/.test(source))
    throw new Error(`${file}: unclassified test definition`);
  for (const match of source.matchAll(/\b(rfc|contract|nonH2Test)\s*\(\s*(['"])(.*?)\2\s*,/g)) {
    definitions++;
    if (match[1] === 'rfc') {
      for (const section of match[3].split(',').map(s => s.trim())) {
        if (!listed.has(section)) throw new Error(`${file}: RFC §${section} is absent from the requirements matrix`);
      }
    } else if (!match[3].trim()) throw new Error(`${file}: empty contract reference`);
  }
  const calls = [...source.matchAll(/\b(?:rfc|contract|nonH2Test)\s*\(/g)].length;
  if (calls !== [...source.matchAll(/\b(rfc|contract|nonH2Test)\s*\(\s*(['"])(.*?)\2\s*,/g)].length)
    throw new Error(`${file}: test without literal classification`);
}
if (definitions < 40) throw new Error(`Only ${definitions} classified test definitions found`);
console.log(`${definitions} test definitions classified; RFC sections linked to docs/PROFILE.md`);
