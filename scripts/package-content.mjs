import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';

// Keep private research names out of the source tree as well as the tarball.
const privateTerms = new Set([
  "a1002a6066af79b08e37db395a95d0d3a51581819b10ac64ba482b1031b76294",
  "c081e5e31b0c0d5d0eea7bb206117d1b8bd8c3cf5f6645d8c6e221b1841e2188",
  "d1c01ba06b10dd865827ca970004848185ee51fed7037c33ef204a731255ea87",
  "079f912e7f330a1bebb8f346ce65568201cec4bf4d2f7eeb69583578542bf91b",
  "e90dfa8b1e73941e209c67b4189b7bbb56dadd6c4a2d00f80500eca86ea20826",
  "7827e8eb2cb3b95f4d0ffac324b65208ff813b66884d08327ab0abb04fe780fb"
]);
export function checkText(path, text) {
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []) {
    assert.ok(!privateTerms.has(createHash('sha256').update(word).digest('hex')), `${path}: private research reference`);
  }
  assert.ok(!/\/(?:home|Users)\/[^/\s]+|\/opt\/nvm|[A-Z]:\\Users\\/i.test(text), `${path}: machine-specific path`);
  assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bnpm_[A-Za-z0-9]{30,}/.test(text), `${path}: possible credential`);
}
export function checkPackage(root, files) {
  for (const { path } of files) {
    assert.ok(/^(?:dist\/(?:esm|cjs)\/|docs\/|README\.md$|LICENSE$|package\.json$)/.test(path), `${path}: unexpected package file`);
    assert.ok(!/(?:^|\/)(?:node_modules|\.git|research)(?:\/|$)|\.(?:key|pem|tgz)$|(?:^|\/)\.env/.test(path), `${path}: private or generated package file`);
    assert.ok(!path.endsWith('.d.ts.map'), `${path}: declaration map points outside package`);
    const absolute = resolve(root, path);
    const text = readFileSync(absolute, 'utf8');
    checkText(path, text);
    if (path.endsWith('.js.map')) {
      const map = JSON.parse(text);
      assert.equal(map.sourcesContent.length, map.sources.length, `${path}: missing embedded sources`);
      assert.ok(map.sourcesContent.every(source => typeof source === 'string'));
    }
    if (!path.endsWith('.md')) continue;
    for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|#)/.test(href)) continue;
      const target = resolve(dirname(absolute), decodeURIComponent(href.split('#')[0]));
      const local = relative(root, target);
      assert.ok(!isAbsolute(local) && local !== '..' && !local.startsWith('../') && !local.startsWith('..\\'), `${path}: link leaves package`);
      assert.ok(existsSync(target), `${path}: broken package link ${href}`);
    }
  }
}
