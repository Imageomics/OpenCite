import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addCitationConsistencyWarnings,
  importGithubMetadata,
  parseCitationCff,
  parseZenodoJson,
  resolvePreferredCitationPath,
  summarizeImportedMetadataFiles,
  validateImportedMetadataFiles,
} from '../../src/services/githubImporter.js';

test('parseCitationCff extracts top-level fields from common CFF content', () => {
  const parsed = parseCitationCff(`cff-version: 1.2.0
message: "Cite this software"
title: "OpenCite"
version: "1.2.3"
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
  assert.equal(parsed.version, '1.2.3');
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
version: "2.0.0"
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
  assert.equal(parsed.version, '2.0.0');
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
    version: '0.1.0',
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
      version: '1.1.0',
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
      version: '1.2.3',
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
      version: '1.2.3',
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

test('resolvePreferredCitationPath only recognizes canonical CITATION.cff', () => {
  const path = resolvePreferredCitationPath({
    'CITATION.cff': 'title: "Upper"',
    'citation.cff': 'title: "Lower"',
  });

  assert.equal(path, 'CITATION.cff');

  const lowercaseOnly = resolvePreferredCitationPath({
    'citation.cff': 'title: "Lower"',
  });

  assert.equal(lowercaseOnly, '');
});

test('summarizeImportedMetadataFiles ignores lowercase citation.cff files entirely', () => {
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
  assert.equal(summary.warnings.some((warning) => warning.code === 'multiple-citation-files'), false);
});

test('importGithubMetadata inspects repository files by default and decodes UTF-8 citation content', async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls = [];

  const citationText = `cff-version: 1.2.0\ntitle: "Café Tool"\nversion: "1.0.0"\ndate-released: "2025-01-02"\nrepository-code: "https://github.com/test-owner/test-repo"\nauthors:\n  - family-names: "Doe"\n    given-names: "Jane"\n`;
  const citationBase64 = Buffer.from(citationText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);
    calledUrls.push(value);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'test-repo',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: [],
        license: { spdx_id: 'MIT' },
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases/latest')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=1&sha=main')) {
      return Response.json([{ commit: { committer: { date: '2025-01-02T00:00:00Z' } } }]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/CITATION.cff?ref=main')) {
      return Response.json({ encoding: 'base64', content: citationBase64 });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([]);
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo');

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.title, 'Café Tool');
    assert.equal(result.metadata.repositoryCode, 'https://github.com/test-owner/test-repo');
    assert.equal(calledUrls.some((value) => value.includes('/contents/CITATION.cff?ref=main')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata prefers CITATION.cff version over latest release tag', async () => {
  const originalFetch = globalThis.fetch;

  const citationText = `cff-version: 1.2.0\ntitle: "OpenCite"\nversion: "2.0.0"\ndate-released: "2025-01-02"\nrepository-code: "https://github.com/test-owner/test-repo"\nauthors:\n  - family-names: "Doe"\n    given-names: "Jane"\n`;
  const citationBase64 = Buffer.from(citationText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'test-repo',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: [],
        license: { spdx_id: 'MIT' },
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases/latest')) {
      return Response.json({
        tag_name: 'v1.5.0',
        published_at: '2025-01-03T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/CITATION.cff?ref=main')) {
      return Response.json({ encoding: 'base64', content: citationBase64 });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([]);
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo');

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.version, '2.0.0');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata does not emit commit-based fallback warning when primary citation authors exist', async () => {
  const originalFetch = globalThis.fetch;

  const citationText = `cff-version: 1.2.0\ntitle: "OpenCite"\nversion: "1.0.0"\ndate-released: "2025-01-02"\nrepository-code: "https://github.com/test-owner/test-repo"\nauthors:\n  - family-names: "Doe"\n    given-names: "Jane"\n`;
  const citationBase64 = Buffer.from(citationText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'test-repo',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: [],
        license: { spdx_id: 'MIT' },
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases/latest')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=1&sha=main')) {
      return Response.json([{ commit: { committer: { date: '2025-01-02T00:00:00Z' } } }]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/CITATION.cff?ref=main')) {
      return Response.json({ encoding: 'base64', content: citationBase64 });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([{ login: 'janedoe', type: 'User' }]);
    }

    if (value.endsWith('/users/janedoe')) {
      return Response.json({
        login: 'janedoe',
        type: 'User',
        name: 'Jane Doe',
        company: 'Imageomics',
        html_url: 'https://github.com/janedoe',
      });
    }

    if (value.endsWith('/users/janedoe/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/janedoe') {
      return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo', {
      contributorFallbackLimit: 5,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.length > 0, true);
    assert.equal(result.warnings.some((warning) => warning.code === 'commit-based-fallback'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata deduplicates duplicate authors imported from CITATION.cff', async () => {
  const originalFetch = globalThis.fetch;

  const citationText = `cff-version: 1.2.0\ntitle: "OpenCite"\nversion: "1.0.0"\ndate-released: "2025-01-02"\nrepository-code: "https://github.com/test-owner/test-repo"\nauthors:\n  - family-names: "Doe"\n    given-names: "Jane"\n  - family-names: "doe"\n    given-names: "jane"\n`;
  const citationBase64 = Buffer.from(citationText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'test-repo',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: [],
        license: { spdx_id: 'MIT' },
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases/latest')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=1&sha=main')) {
      return Response.json([{ commit: { committer: { date: '2025-01-02T00:00:00Z' } } }]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/CITATION.cff?ref=main')) {
      return Response.json({ encoding: 'base64', content: citationBase64 });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([]);
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo');

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.length, 1);
    assert.equal(result.metadata.authors[0].givenNames, 'Jane');
    assert.equal(result.metadata.authors[0].familyNames, 'Doe');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata preserves citation authors when CITATION.cff is invalid but parseable', async () => {
  const originalFetch = globalThis.fetch;

  const citationText = `cff-version: 1.2.0\ntitle: "OpenCite"\nversion: "1.0.0"\ndate-released: "2025-99-99"\nrepository-code: "https://github.com/test-owner/test-repo"\nauthors:\n  - family-names: "Doe"\n    given-names: "Jane"\n  - family-names: "Smith"\n    given-names: "John"\n`;
  const citationBase64 = Buffer.from(citationText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'test-repo',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: [],
        license: { spdx_id: 'MIT' },
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases/latest')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=1&sha=main')) {
      return Response.json([{ commit: { committer: { date: '2025-01-02T00:00:00Z' } } }]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/CITATION.cff?ref=main')) {
      return Response.json({ encoding: 'base64', content: citationBase64 });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([]);
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo');

    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.some((warning) => warning.code === 'citation-file-skipped'), true);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Jane' && author.familyNames === 'Doe'), true);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'John' && author.familyNames === 'Smith'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata includes contributor authors in addition to citation authors', async () => {
  const originalFetch = globalThis.fetch;

  const citationText = `cff-version: 1.2.0\ntitle: "OpenCite"\nversion: "1.0.0"\ndate-released: "2025-01-02"\nrepository-code: "https://github.com/test-owner/test-repo"\nauthors:\n  - family-names: "Doe"\n    given-names: "Jane"\n`;
  const citationBase64 = Buffer.from(citationText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'test-repo',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: [],
        license: { spdx_id: 'MIT' },
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases/latest')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=1&sha=main')) {
      return Response.json([{ commit: { committer: { date: '2025-01-02T00:00:00Z' } } }]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/CITATION.cff?ref=main')) {
      return Response.json({ encoding: 'base64', content: citationBase64 });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([
        { login: 'janedoe', type: 'User' },
        { login: 'johnsmith', type: 'User' },
      ]);
    }

    if (value.endsWith('/users/janedoe')) {
      return Response.json({
        login: 'janedoe',
        type: 'User',
        name: 'Jane Doe',
        company: 'Imageomics',
        html_url: 'https://github.com/janedoe',
      });
    }

    if (value.endsWith('/users/johnsmith')) {
      return Response.json({
        login: 'johnsmith',
        type: 'User',
        name: 'John Smith',
        company: 'Imageomics',
        html_url: 'https://github.com/johnsmith',
      });
    }

    if (value.endsWith('/users/janedoe/social_accounts') || value.endsWith('/users/johnsmith/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/janedoe' || value === 'https://github.com/johnsmith') {
      return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo', {
      contributorFallbackLimit: 5,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Jane' && author.familyNames === 'Doe'), true);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'John' && author.familyNames === 'Smith'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata orders imported authors by contributor rank', async () => {
  const originalFetch = globalThis.fetch;

  const citationText = `cff-version: 1.2.0\ntitle: "OpenCite"\nversion: "1.0.0"\ndate-released: "2025-01-02"\nrepository-code: "https://github.com/test-owner/test-repo"\nauthors:\n  - family-names: "Doe"\n    given-names: "Jane"\n  - family-names: "Smith"\n    given-names: "John"\n`;
  const citationBase64 = Buffer.from(citationText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'test-repo',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: [],
        license: { spdx_id: 'MIT' },
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases/latest')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=1&sha=main')) {
      return Response.json([{ commit: { committer: { date: '2025-01-02T00:00:00Z' } } }]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/CITATION.cff?ref=main')) {
      return Response.json({ encoding: 'base64', content: citationBase64 });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      // John appears first => highest contributor rank.
      return Response.json([
        { login: 'johnsmith', type: 'User' },
        { login: 'janedoe', type: 'User' },
      ]);
    }

    if (value.endsWith('/users/janedoe')) {
      return Response.json({
        login: 'janedoe',
        type: 'User',
        name: 'Jane Doe',
        company: 'Imageomics',
        html_url: 'https://github.com/janedoe',
      });
    }

    if (value.endsWith('/users/johnsmith')) {
      return Response.json({
        login: 'johnsmith',
        type: 'User',
        name: 'John Smith',
        company: 'Imageomics',
        html_url: 'https://github.com/johnsmith',
      });
    }

    if (value.endsWith('/users/janedoe/social_accounts') || value.endsWith('/users/johnsmith/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/janedoe' || value === 'https://github.com/johnsmith') {
      return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo', {
      contributorFallbackLimit: 5,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.length >= 2, true);
    assert.equal(result.metadata.authors[0].givenNames, 'John');
    assert.equal(result.metadata.authors[0].familyNames, 'Smith');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata deduplicates likely name variants between citation and contributors', async () => {
  const originalFetch = globalThis.fetch;

  const citationText = `cff-version: 1.2.0\ntitle: "OpenCite"\nversion: "1.0.0"\ndate-released: "2025-01-02"\nrepository-code: "https://github.com/test-owner/test-repo"\nauthors:\n  - family-names: "Doe"\n    given-names: "Jane"\n`;
  const citationBase64 = Buffer.from(citationText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'test-repo',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: [],
        license: { spdx_id: 'MIT' },
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases/latest')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=1&sha=main')) {
      return Response.json([{ commit: { committer: { date: '2025-01-02T00:00:00Z' } } }]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/CITATION.cff?ref=main')) {
      return Response.json({ encoding: 'base64', content: citationBase64 });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([{ login: 'janedoe', type: 'User' }]);
    }

    if (value.endsWith('/users/janedoe')) {
      return Response.json({
        login: 'janedoe',
        type: 'User',
        name: 'Jane A Doe',
        company: 'Imageomics',
        html_url: 'https://github.com/janedoe',
      });
    }

    if (value.endsWith('/users/janedoe/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/janedoe') {
      return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo', {
      contributorFallbackLimit: 5,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.length, 1);
    assert.equal(result.metadata.authors[0].familyNames, 'Doe');
    assert.equal(result.metadata.authors[0].givenNames.startsWith('Jane'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
