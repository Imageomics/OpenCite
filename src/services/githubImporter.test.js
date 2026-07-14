import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addCitationConsistencyWarnings,
  parseCitationCff,
  parseZenodoJson,
  resolvePreferredCitationPath,
  summarizeImportedMetadataFiles,
  validateImportedMetadataFiles,
} from './githubImporter.js';

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

test('parseCitationCff pulls authors and key metadata fields from citation content', () => {
  const parsed = parseCitationCff(`cff-version: 1.2.0
title: "OpenCite"
abstract: "Citation metadata tool"
version: "v2.0.0"
date-released: "2026-07-13"
repository-code: "https://github.com/Imageomics/OpenCite"
license: "MIT"
doi: "10.5281/zenodo.1234567"
keywords:
  - metadata
  - citation
authors:
  - name: "Jane Doe"
    affiliation: "Imageomics Lab"
    orcid: "https://orcid.org/0000-0002-1825-0097"
references:
  - doi: "10.1000/xyz123"
  - url: "https://example.org/paper"
`);

  assert.equal(parsed.title, 'OpenCite');
  assert.equal(parsed.abstract, 'Citation metadata tool');
  assert.equal(parsed.version, 'v2.0.0');
  assert.equal(parsed.publicationDate, '2026-07-13');
  assert.equal(parsed.repositoryCode, 'https://github.com/Imageomics/OpenCite');
  assert.equal(parsed.license, 'MIT');
  assert.equal(parsed.doi, '10.5281/zenodo.1234567');
  assert.deepEqual(parsed.keywords, ['metadata', 'citation']);

  assert.equal(parsed.authors.length, 1);
  assert.equal(parsed.authors[0].givenNames, 'Jane');
  assert.equal(parsed.authors[0].familyNames, 'Doe');
  assert.equal(parsed.authors[0].affiliation, 'Imageomics Lab');
  assert.equal(parsed.authors[0].orcid, 'https://orcid.org/0000-0002-1825-0097');

  assert.deepEqual(parsed.references, ['https://doi.org/10.1000/xyz123', 'https://example.org/paper']);
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

test('addCitationConsistencyWarnings reports repository/version/date/license mismatches', () => {
  const warnings = [];

  addCitationConsistencyWarnings({
    warnings,
    citation: {
      version: '1.0.0',
      publicationDate: '2026-07-01',
      repositoryCode: 'https://github.com/Imageomics/OldRepo',
      license: 'Apache-2.0',
    },
    zenodo: {
      version: '0.9.0',
      publicationDate: '2026-07-02',
      license: 'GPL-3.0',
    },
    releaseData: {
      tag_name: 'v1.1.0',
      published_at: '2026-07-03T00:00:00Z',
    },
    repoData: {
      html_url: 'https://github.com/Imageomics/OpenCite',
      license: { spdx_id: 'MIT' },
    },
    metadata: {
      version: 'v1.1.0',
    },
  });

  const codes = new Set(warnings.map((warning) => warning.code));

  assert.equal(codes.has('repository-url-mismatch'), true);
  assert.equal(codes.has('version-mismatch'), true);
  assert.equal(codes.has('cross-file-version-mismatch'), true);
  assert.equal(codes.has('date-mismatch'), true);
  assert.equal(codes.has('license-mismatch'), true);
});

test('addCitationConsistencyWarnings treats v-prefixed versions and normalized repository URLs as equivalent', () => {
  const warnings = [];

  addCitationConsistencyWarnings({
    warnings,
    citation: {
      version: '1.2.3',
      repositoryCode: 'git+https://github.com/Imageomics/OpenCite.git',
      publicationDate: '2026-07-12',
      license: 'MIT',
    },
    zenodo: {
      version: 'v1.2.3',
      publicationDate: '2026-07-12',
      license: 'mit',
    },
    releaseData: {
      tag_name: 'v1.2.3',
      published_at: '2026-07-12T13:00:00Z',
    },
    repoData: {
      html_url: 'https://github.com/imageomics/OpenCite/',
      license: { spdx_id: 'MIT' },
    },
    metadata: {
      version: 'v1.2.3',
    },
  });

  const mismatchCodes = new Set(
    warnings
      .map((warning) => warning.code)
      .filter((code) =>
        ['version-mismatch', 'cross-file-version-mismatch', 'repository-url-mismatch', 'date-mismatch', 'license-mismatch'].includes(code),
      ),
  );

  assert.deepEqual([...mismatchCodes], []);
});

test('validateImportedMetadataFiles flags invalid CITATION.cff and .zenodo.json content', () => {
  const warnings = validateImportedMetadataFiles({
    'CITATION.cff': `cff-version: 1.2.0
title: "OpenCite"
version: "1.0.0"
date-released: "2026-99-99"
`,
    '.zenodo.json': JSON.stringify({
      title: 'OpenCite',
      version: '',
      publication_date: '2026-13-01',
      upload_type: 'software',
      creators: [],
      grants: [{ id: 'invalid' }],
    }),
  });

  const codes = new Set(warnings.map((warning) => warning.code));
  assert.equal(codes.has('citation-file-invalid'), true);
  assert.equal(codes.has('zenodo-file-invalid'), true);
});

test('validateImportedMetadataFiles does not emit invalid-file warnings for valid metadata files', () => {
  const warnings = validateImportedMetadataFiles({
    'CITATION.cff': `cff-version: 1.2.0
title: "OpenCite"
version: "1.0.0"
date-released: "2026-07-12"
repository-code: "https://github.com/imageomics/opencite"
`,
    '.zenodo.json': JSON.stringify({
      title: 'OpenCite',
      version: '1.0.0',
      publication_date: '2026-07-12',
      upload_type: 'software',
      creators: [{ name: 'Doe, Jane' }],
      grants: [{ id: '021nxhr62::2118240' }],
    }),
  });

  const invalidCodes = warnings
    .map((warning) => warning.code)
    .filter((code) => code === 'citation-file-invalid' || code === 'zenodo-file-invalid');

  assert.deepEqual(invalidCodes, []);
});

test('summarizeImportedMetadataFiles marks invalid citation file as not valid', () => {
  const summary = summarizeImportedMetadataFiles({
    'CITATION.cff': `cff-version: 1.2.0
title: "OpenCite"
version: ""
date-released: "2026-07-12"
`,
  });

  assert.equal(summary.citation.present, true);
  assert.equal(summary.citation.valid, false);
  assert.equal(summary.citation.path, 'CITATION.cff');
  assert.equal(summary.warnings.some((warning) => warning.code === 'citation-file-invalid'), true);
});

test('summarizeImportedMetadataFiles marks valid citation file as valid', () => {
  const summary = summarizeImportedMetadataFiles({
    'CITATION.cff': `cff-version: 1.2.0
title: "OpenCite"
version: "1.0.0"
date-released: "2026-07-12"
repository-code: "https://github.com/imageomics/opencite"
`,
  });

  assert.equal(summary.citation.present, true);
  assert.equal(summary.citation.valid, true);
  assert.deepEqual(summary.citation.errors, []);
});

test('resolvePreferredCitationPath prefers canonical CITATION.cff when both files exist', () => {
  const path = resolvePreferredCitationPath({
    'CITATION.cff': 'title: "Upper"',
    'citation.cff': 'title: "Lower"',
  });

  assert.equal(path, 'CITATION.cff');
});

test('summarizeImportedMetadataFiles warns when both citation filename variants exist', () => {
  const summary = summarizeImportedMetadataFiles({
    'CITATION.cff': `cff-version: 1.2.0
title: "Upper"
version: "1.0.0"
date-released: "2026-07-12"
repository-code: "https://github.com/imageomics/opencite"
`,
    'citation.cff': `cff-version: 1.2.0
title: "Lower"
version: "0.1.0"
date-released: "2025-01-01"
repository-code: "https://github.com/example/old"
`,
  });

  assert.equal(summary.citation.path, 'CITATION.cff');
  assert.equal(summary.warnings.some((warning) => warning.code === 'multiple-citation-files'), true);
});
