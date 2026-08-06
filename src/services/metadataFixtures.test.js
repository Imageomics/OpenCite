import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { validateCitationCffText } from './citationValidation.js';
import { validateZenodoJsonText } from './zenodoValidation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function readFixture(name) {
  const filePath = path.join(__dirname, 'fixtures', name);
  return readFile(filePath, 'utf8');
}

test('valid citation fixture passes validation', async () => {
  const text = await readFixture('valid.CITATION.cff');
  const result = validateCitationCffText(text);

  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
  assert.match(result.report, /Status: PASS/);
});

test('invalid citation fixture fails validation with useful report details', async () => {
  const text = await readFixture('invalid.CITATION.cff');
  const result = validateCitationCffText(text);

  assert.equal(result.isValid, false);
  assert.equal(result.errors.some((entry) => /date-released/.test(entry)), true);
  assert.match(result.report, /Status: FAIL/);
  assert.match(result.report, /date-released/);
});

test('valid zenodo fixture passes validation', async () => {
  const text = await readFixture('valid.zenodo.json');
  const result = validateZenodoJsonText(text);

  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
  assert.match(result.report, /Status: PASS/);
});

test('invalid zenodo fixture fails validation with useful report details', async () => {
  const text = await readFixture('invalid.zenodo.json');
  const result = validateZenodoJsonText(text);

  assert.equal(result.isValid, false);
  assert.equal(result.errors.some((entry) => /title is required/.test(entry)), true);
  assert.equal(result.errors.some((entry) => /version is required/.test(entry)), true);
  assert.equal(result.errors.some((entry) => /publication_date/.test(entry)), true);
  assert.equal(result.errors.some((entry) => /creators/.test(entry)), true);
  assert.equal(result.errors.some((entry) => /grants\[0\]/.test(entry)), true);
  assert.match(result.report, /Status: FAIL/);
  assert.match(result.report, /Errors:/);
});
