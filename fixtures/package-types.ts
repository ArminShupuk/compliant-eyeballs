// Contract: TypeScript module resolution and declaration checking.
// https://www.typescriptlang.org/docs/handbook/modules/reference.html
import { strict as assert } from 'node:assert';
import { connectTcp, type Resolver } from 'compliant-eyeballs';
import { createHttpsAgent } from 'compliant-eyeballs/agents';
import { createUndiciConnector, type UndiciConnectorOptions } from 'compliant-eyeballs/undici';

// Compile these calls without opening connections when the emitted fixture runs.
function checkTypes() {
  const resolver: Resolver = ({ families }, update) => {
    for (const family of families) update({ family, addresses: [], complete: true });
  };
  void connectTcp({ hostname: 'localhost', port: 80, resolver });
  createHttpsAgent({ ca: 'test', connection: { resolver } });
  createUndiciConnector({ allowH2: true, resolver });
  // @ts-expect-error The root entrypoint must retain its option types.
  void connectTcp({ hostname: 'localhost', port: '80' });
  // @ts-expect-error Agent options must retain their nested connection types.
  createHttpsAgent({ connection: { connectTimeoutMs: 'slow' } });
  // @ts-expect-error The connector must not resolve to an untyped module.
  createUndiciConnector({ allowH2: 'yes' });
}
void checkTypes;

const options: UndiciConnectorOptions = {
  connectTimeoutMs: 30_000,
  allowH2: true,
  tls: { ecdhCurve: 'auto', ALPNProtocols: ['h2', 'http/1.1'] },
};
const connector = createUndiciConnector(options);
assert.equal(typeof connector, 'function');
connector.destroy();
const agent = createHttpsAgent();
agent.destroy();
assert.equal(typeof connectTcp, 'function');
