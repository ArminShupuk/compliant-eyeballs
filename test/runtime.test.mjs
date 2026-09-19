import { contract } from './classification.mjs';
import { readdir } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';

contract('ES module import and Node Agent APIs', 'every runtime module imports without changing native agent prototypes', async () => {
  const before = [http.Agent, https.Agent].map(Agent => Object.getOwnPropertyDescriptors(Agent.prototype));
  for (const file of await readdir(new URL('../dist/esm/', import.meta.url))) {
    if (file.endsWith('.js')) await import(new URL(`../dist/esm/${file}`, import.meta.url));
  }
  assert.deepEqual([http.Agent, https.Agent].map(Agent => Object.getOwnPropertyDescriptors(Agent.prototype)), before);
});
