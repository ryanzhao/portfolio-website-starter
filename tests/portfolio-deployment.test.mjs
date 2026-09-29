import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('public preview template has no production route or remote resource bindings', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'portfolio-local-preview');
  assert.equal(config.routes, undefined);
  assert.ok(config.r2_buckets.every(binding => binding.remote === false && binding.bucket_name.startsWith('replace-with-your-')));
  assert.ok(config.d1_databases.every(binding => binding.remote === false && binding.database_id === '00000000-0000-0000-0000-000000000000'));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.services, [{binding: 'WORKER_SELF_REFERENCE', service: config.name}]);
});
