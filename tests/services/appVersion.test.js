import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { APP_VERSION } from '../../src/appVersion.js';
import { toCitationCff } from '../../src/services/citation.js';

test('APP_VERSION is loaded from package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
});

test('CITATION.cff starts with the OpenCite generation comment', () => {
  const cff = toCitationCff({
    title: 'T',
    authors: [],
    keywords: [],
    version: '1.0.0',
    license: 'MIT',
  });
  assert.equal(cff.split('\n')[0], `# Generated with OpenCite version ${APP_VERSION}`);
});
