import test from 'node:test';
import assert from 'node:assert/strict';

import { validateCitationCffText } from './citationValidation.js';

test('validateCitationCffText accepts valid citation metadata', () => {
  const result = validateCitationCffText(`cff-version: 1.2.0
title: "OpenCite"
version: "v1.2.3"
date-released: "2026-07-12"
repository-code: "https://github.com/Imageomics/OpenCite"
`);

  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
});

test('validateCitationCffText accepts unquoted scalar values for common fields', () => {
  const result = validateCitationCffText(`cff-version: 1.2.0
title: OpenCite
version: 1.0.0
date-released: 2026-07-12
repository-code: https://github.com/Imageomics/OpenCite
`);

  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.fields.title, 'OpenCite');
  assert.equal(result.fields.version, '1.0.0');
  assert.equal(result.fields.repositoryCode, 'https://github.com/Imageomics/OpenCite');
});

test('validateCitationCffText rejects invalid date and invalid grant IDs', () => {
  const result = validateCitationCffText(`cff-version: 1.2.0
title: "OpenCite"
version: "v1.2.3"
date-released: "2026-99-12"
repository-code: "https://github.com/Imageomics/OpenCite"
grants:
  - id: "bad-grant"
`);

  assert.equal(result.isValid, false);
  assert.equal(result.errors.some((entry) => /date-released/.test(entry)), true);
  assert.equal(result.errors.some((entry) => /grants\[0\]/.test(entry)), true);
});
