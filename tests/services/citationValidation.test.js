import test from 'node:test';
import assert from 'node:assert/strict';

import { validateCitationCffText } from '../../src/services/citationValidation.js';
import { toCitationCff } from '../../src/services/citation.js';

test('validateCitationCffText accepts valid citation metadata', () => {
  const result = validateCitationCffText(`cff-version: 1.2.0
title: "OpenCite"
version: "1.2.3"
date-released: "2026-07-12"
repository-code: "https://github.com/Imageomics/OpenCite"
authors:
  - family-names: "Doe"
    given-names: "Jane"
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
authors:
  - family-names: Doe
    given-names: Jane
`);

  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.fields.title, 'OpenCite');
  assert.equal(result.fields.version, '1.0.0');
  assert.equal(result.fields.repositoryCode, 'https://github.com/Imageomics/OpenCite');
});

test('validateCitationCffText rejects invalid date', () => {
  const result = validateCitationCffText(`cff-version: 1.2.0
title: "OpenCite"
version: "1.2.3"
date-released: "2026-99-12"
repository-code: "https://github.com/Imageomics/OpenCite"
authors:
  - family-names: "Doe"
    given-names: "Jane"
`);

  assert.equal(result.isValid, false);
  assert.equal(result.errors.some((entry) => /date-released/.test(entry)), true);
});

test('validateCitationCffText rejects missing authors', () => {
  const result = validateCitationCffText(`cff-version: 1.2.0
title: "OpenCite"
version: "1.2.3"
date-released: "2026-07-12"
repository-code: "https://github.com/Imageomics/OpenCite"
`);

  assert.equal(result.isValid, false);
  assert.equal(result.errors.some((entry) => /authors/i.test(entry)), true);
});

test('toCitationCff omits empty author name fields in references', () => {
  const output = toCitationCff({
    title: 'OpenCite',
    authors: [],
    keywords: [],
    license: 'MIT',
    typeOfWork: 'software',
    customTypeOfWork: '',
    version: '1.0.0',
    publicationDate: '2026-07-12',
    repositoryCode: 'https://github.com/Imageomics/OpenCite',
    doi: '',
    abstract: '',
    references: [
      {
        title: 'Referenced software',
        authors: [{ orcid: 'https://orcid.org/0000-0002-1825-0097' }],
      },
    ],
    grants: [],
  });

  assert.match(output, /authors:/);
  assert.doesNotMatch(output, /family-names: ""/);
  assert.doesNotMatch(output, /given-names: ""/);
  assert.match(output, /orcid: "https:\/\/orcid\.org\/0000-0002-1825-0097"/);
});
