import { readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

// The CLI checks totals. This reporter also rejects omitted or partially covered
// runtime modules, so a new file cannot disappear from the coverage denominator.
export default async function* coverageReport(events) {
  let reported = false;
  for await (const event of events) {
    if (event.type !== 'test:coverage') continue;
    reported = true;
    const { summary } = event.data;
    const expected = readdirSync('dist/esm').filter(name => name.endsWith('.js'));
    const files = new Map(summary.files.map(file => [resolve(file.path), file]));
    const modules = expected.map(name => {
      const file = files.get(resolve('dist/esm', name));
      if (!file) throw Error(`Runtime module omitted from coverage: ${name}`);
      for (const metric of ['coveredLinePercent', 'coveredBranchPercent', 'coveredFunctionPercent']) {
        if (file[metric] !== 100) {
          const uncalled = file.functions.filter(fn => fn.count === 0).map(fn => `${fn.name || '<anonymous>'}:${fn.line}`);
          throw Error(`${name}: ${metric} must be 100, received ${file[metric]}${uncalled.length ? `; uncalled functions: ${uncalled.join(', ')}` : ''}`);
        }
      }
      return { path: relative(process.cwd(), file.path).replaceAll('\\', '/'),
        lines: file.coveredLinePercent, branches: file.coveredBranchPercent, functions: file.coveredFunctionPercent };
    });
    yield JSON.stringify({ node: process.versions.node, modules }, null, 2) + '\n';
  }
  if (!reported) throw Error('Test runner produced no coverage report');
}
