import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCitationCff, parseZenodoJson } from './githubImporter.js';

test('parseCitationCff extracts top-level fields from common CFF content', () => {
  const parsed = parseCitationCff(`cff-version: 1.2.0
message: "Cite this software"
title: "OpenCite"
version: "v1.2.3"
date-released: "2026-07-12"
repository-code: "https://github.com/Imageomics/OpenCite"
license: "MIT"
keywords:
  - imageomics
  - citation
authors:
  - family-names: "Doe"
    given-names: "Jane"
`);

  assert.equal(parsed.title, 'OpenCite');
  assert.equal(parsed.version, 'v1.2.3');
  assert.equal(parsed.publicationDate, '2026-07-12');
  assert.equal(parsed.repositoryCode, 'https://github.com/Imageomics/OpenCite');
  assert.deepEqual(parsed.keywords, ['imageomics', 'citation']);
  assert.equal(parsed.authors.length, 1);
});

test('parseCitationCff emits warning for preferred-citation sections', () => {
  const parsed = parseCitationCff(`cff-version: 1.2.0
title: "OpenCite"
preferred-citation:
  type: article
  title: "Preferred paper"
`);

  assert.ok(Array.isArray(parsed._warnings));
  assert.equal(parsed._warnings.length > 0, true);
  assert.match(parsed._warnings[0], /preferred-citation/i);
});

test('parseZenodoJson extracts grants and references from zenodo metadata', () => {
  const parsed = parseZenodoJson(JSON.stringify({
    title: 'OpenCite',
    version: 'v0.1.0',
    publication_date: '2026-07-12',
    grants: [{ id: '021nxhr62::2118240' }],
    references: ['https://doi.org/10.1000/xyz123'],
    creators: [{ name: 'Doe, Jane', affiliation: 'Imageomics' }],
  }));

  assert.deepEqual(parsed.grants, ['021nxhr62::2118240']);
  assert.deepEqual(parsed.references, ['https://doi.org/10.1000/xyz123']);
  assert.equal(parsed.authors.length, 1);
});
