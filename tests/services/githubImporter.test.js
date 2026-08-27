import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGithubCommitListApiUrl,
  buildGithubRequestConfig,
  fetchJson,
} from '../../src/services/githubApi.js';
import {
  addCitationConsistencyWarnings,
  importGithubMetadata,
  parseCitationCff,
  parseZenodoJson,
  resolvePreferredCitationPath,
  summarizeImportedMetadataFiles,
  validateImportedMetadataFiles,
} from '../../src/services/githubImporter.js';
import { stripWrappingQuotes } from '../../src/services/githubImporterUtils.js';

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

test('buildGithubRequestConfig returns the same GitHub request-field shape', () => {
  const onWarning = () => {};
  const config = buildGithubRequestConfig({
    authToken: 'token-123',
    source: 'release',
    label: 'the latest release',
    onWarning,
  });

  assert.deepEqual(config, {
    authToken: 'token-123',
    source: 'release',
    label: 'the latest release',
    onWarning,
  });
});

test('fetchJson recognizes GitHub rate-limit 403 responses from the response message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { message: 'API rate limit exceeded for 127.0.0.1.' },
    { status: 403 },
  );

  try {
    const result = await fetchJson('https://api.github.com/repos/test-owner/test-repo');
    assert.equal(result.rateLimited, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildGithubCommitListApiUrl preserves default branch filters and encodes branch names', () => {
  assert.equal(
    buildGithubCommitListApiUrl('Imageomics', 'OpenCite'),
    'https://api.github.com/repos/Imageomics/OpenCite/commits?per_page=1',
  );

  assert.equal(
    buildGithubCommitListApiUrl('Imageomics', 'OpenCite', 'feature/my-branch'),
    'https://api.github.com/repos/Imageomics/OpenCite/commits?per_page=1&sha=feature%2Fmy-branch',
  );
});

test('stripWrappingQuotes removes matching quote wrappers without altering inner text', () => {
  assert.equal(stripWrappingQuotes('"OpenCite"'), 'OpenCite');
  assert.equal(stripWrappingQuotes("'OpenCite'"), 'OpenCite');
  assert.equal(stripWrappingQuotes('OpenCite'), 'OpenCite');
  assert.equal(stripWrappingQuotes('"quoted \\"text\\""'), 'quoted \\"text\\"');
  assert.equal(stripWrappingQuotes('"OpenCite\''), '"OpenCite\'');
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

test('addCitationConsistencyWarnings reports repository/license mismatches and invalid versions', () => {
  const warnings = [];

  addCitationConsistencyWarnings({
    warnings,
    citation: {
      version: '1.0',
      publicationDate: '2026-07-01',
      repositoryCode: 'https://github.com/Imageomics/OldRepo',
      license: 'Apache-2.0',
    },
    zenodo: {
      version: '0.9',
      publicationDate: '2026-07-02',
      license: 'GPL-3.0',
    },
    releaseData: {
      tag_name: 'v1.1',
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
  assert.equal(codes.has('invalid-version'), true);
  assert.equal(codes.has('cross-file-version-mismatch'), true);
  assert.equal(codes.has('date-mismatch'), false);
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

test('validateImportedMetadataFiles accepts complete catalog metadata without upload_type', () => {
  const warnings = validateImportedMetadataFiles({
    'CITATION.cff': `cff-version: 1.2.0
title: "Imageomics Catalog"
version: "5.0.1"
date-released: "2026-08-24"
authors:
- family-names: "Campolongo"
  given-names: "Elizabeth G."
repository-code: "https://github.com/Imageomics/catalog"
`,
    '.zenodo.json': JSON.stringify({
      title: 'Imageomics Catalog',
      version: '5.0.1',
      publication_date: '2026-08-24',
      creators: [{ name: 'Campolongo, Elizabeth G.' }],
    }),
  });

  assert.equal(warnings.some((warning) => warning.code === 'citation-file-invalid'), false);
  assert.equal(warnings.some((warning) => warning.code === 'zenodo-file-invalid'), false);
  assert.equal(warnings.some((warning) => warning.code === 'zenodo-file-warning'), true);
});

test('validateImportedMetadataFiles does not emit invalid-file warnings for valid metadata files', () => {
  const warnings = validateImportedMetadataFiles({
    'CITATION.cff': `cff-version: 1.2.0
title: "OpenCite"
version: "1.0.0"
date-released: "2026-07-12"
repository-code: "https://github.com/imageomics/opencite"
authors:
  - family-names: "Doe"
    given-names: "Jane"
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
authors:
  - family-names: "Doe"
    given-names: "Jane"
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

test('importGithubMetadata checks the release list instead of hitting the 404-prone latest-release endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls = [];

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

    if (value.endsWith('/repos/test-owner/test-repo/releases?per_page=1')) {
      return Response.json([]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=1&sha=main')) {
      return Response.json([{ commit: { committer: { date: '2025-01-02T00:00:00Z' } } }]);
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([]);
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo');

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.version, '');
    assert.equal(calledUrls.some((value) => value.endsWith('/repos/test-owner/test-repo/releases?per_page=1')), true);
    assert.equal(calledUrls.some((value) => value.endsWith('/repos/test-owner/test-repo/releases/latest')), false);
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

test('importGithubMetadata ignores invalid CITATION.cff non-author fields but still uses repository/release fallback metadata', async () => {
  const originalFetch = globalThis.fetch;

  const citationText = `cff-version: 1.2.0\ntitle: "Incorrect Title"\nversion: "9.9.9"\ndate-released: "2025-99-99"\nrepository-code: "https://github.com/other/repo"\nlicense: "Apache-2.0"\nauthors:\n  - family-names: "Doe"\n    given-names: "Jane"\n`;
  const citationBase64 = Buffer.from(citationText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'repo-fallback-name',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: [],
        license: { spdx_id: 'MIT' },
        description: 'Repository description fallback',
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases?per_page=1')) {
      return Response.json([{
        tag_name: 'v1.5.0',
        published_at: '2025-01-03T00:00:00Z',
      }]);
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
    assert.equal(result.warnings.some((warning) => warning.code === 'citation-file-invalid'), true);
    assert.equal(result.warnings.some((warning) => warning.code === 'citation-file-skipped'), true);
    assert.equal(result.metadata.title, 'repo-fallback-name');
    assert.equal(result.metadata.version, 'v1.5.0');
    assert.equal(result.metadata.license, 'MIT');
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Jane' && author.familyNames === 'Doe'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata ignores invalid .zenodo.json and still uses repository/release fallback metadata', async () => {
  const originalFetch = globalThis.fetch;

  const zenodoText = JSON.stringify({
    title: 'Broken Zenodo Title',
    version: '',
    publication_date: '2025-13-40',
    creators: [],
    grants: [{ id: 'invalid' }],
  });
  const zenodoBase64 = Buffer.from(zenodoText, 'utf8').toString('base64');

  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.endsWith('/repos/test-owner/test-repo')) {
      return Response.json({
        name: 'repo-fallback-name',
        html_url: 'https://github.com/test-owner/test-repo',
        default_branch: 'main',
        topics: ['citation'],
        license: { spdx_id: 'MIT' },
        description: 'Repository description fallback',
        created_at: '2025-01-01T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/releases?per_page=1')) {
      return Response.json([{
        tag_name: 'v2.1.0',
        published_at: '2025-02-03T00:00:00Z',
      }]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/.zenodo.json?ref=main')) {
      return Response.json({ encoding: 'base64', content: zenodoBase64 });
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
    assert.equal(result.warnings.some((warning) => warning.code === 'zenodo-file-invalid'), true);
    assert.equal(result.warnings.some((warning) => warning.code === 'zenodo-file-skipped'), true);
    assert.equal(result.metadata.title, 'repo-fallback-name');
    assert.equal(result.metadata.version, 'v2.1.0');
    assert.equal(result.metadata.publicationDate, '2025-02-03');
    assert.equal(result.metadata.repositoryCode, 'https://github.com/test-owner/test-repo');
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

test('importGithubMetadata ignores username-like contributors when no real profile name is available', async () => {
  const originalFetch = globalThis.fetch;

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

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=10&sha=main')) {
      return Response.json([
        {
          commit: {
            committer: { date: '2025-01-02T00:00:00Z' },
            message: 'Implement feature',
          },
        },
      ]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([
        { login: 'jane-doe-42', type: 'User' },
      ]);
    }

    if (value.endsWith('/users/jane-doe-42')) {
      return Response.json({
        login: 'jane-doe-42',
        type: 'User',
        name: '',
        html_url: 'https://github.com/jane-doe-42',
      });
    }

    if (value.endsWith('/users/jane-doe-42/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/jane-doe-42') {
      return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo', {
      contributorFallbackLimit: 5,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.some((author) => /jane|doe/i.test(author.givenNames ?? '') || /jane|doe/i.test(author.familyNames ?? '')), false);
    assert.equal(result.metadata.authors.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata excludes AI bot co-authors and contributor accounts while keeping real people', async () => {
  const originalFetch = globalThis.fetch;

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

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=10&sha=main')) {
      return Response.json([
        {
          commit: {
            committer: { date: '2025-01-02T00:00:00Z' },
            message: 'Implement feature\n\nCo-authored-by: Net <net@example.com>\nCo-authored-by: GitHub Copilot <copilot@github.com>\nCo-authored-by: Claude Fable 5 <claude@example.com>',
          },
        },
      ]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([
        { login: 'claude-code', type: 'User' },
        { login: 'copilot-swe-agent', type: 'User' },
      ]);
    }

    if (value.endsWith('/users/claude-code')) {
      return Response.json({
        login: 'claude-code',
        type: 'User',
        name: 'Claude Code',
        html_url: 'https://github.com/claude-code',
      });
    }

    if (value.endsWith('/users/copilot-swe-agent')) {
      return Response.json({
        login: 'copilot-swe-agent',
        type: 'User',
        name: 'GitHub Copilot',
        html_url: 'https://github.com/copilot-swe-agent',
      });
    }

    if (value.endsWith('/users/claude-code/social_accounts') || value.endsWith('/users/copilot-swe-agent/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/claude-code' || value === 'https://github.com/copilot-swe-agent') {
      return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo', {
      contributorFallbackLimit: 5,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Net' && !author.familyNames), true);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Claude' && author.familyNames === 'Fable'), false);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'GitHub' && author.familyNames === 'Copilot'), false);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Claude' && author.familyNames === 'Code'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata ignores GitHub usernames in co-author names and prefers real names', async () => {
  const originalFetch = globalThis.fetch;

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

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=10&sha=main')) {
      return Response.json([
        {
          commit: {
            committer: { date: '2025-01-02T00:00:00Z' },
            message: 'Implement feature\n\nCo-authored-by: egrace479 <egrace479@example.com>\nCo-authored-by: Jane Doe <jane@example.com>',
          },
        },
      ]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([
        { login: 'egrace479', type: 'User' },
      ]);
    }

    if (value.endsWith('/users/egrace479')) {
      return Response.json({
        login: 'egrace479',
        type: 'User',
        name: 'Elizabeth Campolongo',
        html_url: 'https://github.com/egrace479',
      });
    }

    if (value.endsWith('/users/egrace479/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/egrace479') {
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
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Elizabeth' && author.familyNames === 'Campolongo'), true);
    assert.equal(result.metadata.authors.some((author) => /^egrace/i.test(author.givenNames ?? '') || /^egrace/i.test(author.familyNames ?? '')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata prefers commit co-author names over username fallback values', async () => {
  const originalFetch = globalThis.fetch;

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

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=10&sha=main')) {
      return Response.json([
        {
          commit: {
            committer: { date: '2025-01-02T00:00:00Z' },
            message: 'Implement feature\n\nCo-authored-by: Jane Doe <jane@example.com>',
          },
        },
      ]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([
        { login: 'jane-doe-42', type: 'User' },
      ]);
    }

    if (value.endsWith('/users/jane-doe-42')) {
      return Response.json({
        login: 'jane-doe-42',
        type: 'User',
        name: '',
        html_url: 'https://github.com/jane-doe-42',
      });
    }

    if (value.endsWith('/users/jane-doe-42/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/jane-doe-42') {
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
    assert.equal(result.metadata.authors.some((author) => /jane-doe-42/i.test(author.givenNames ?? '') || /jane-doe-42/i.test(author.familyNames ?? '')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata includes co-authored contributor names from commit messages', async () => {
  const originalFetch = globalThis.fetch;

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

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=10&sha=main')) {
      return Response.json([
        {
          commit: {
            committer: { date: '2025-01-02T00:00:00Z' },
            message: 'Implement feature\n\nCo-authored-by: Net <net@example.com>',
          },
        },
      ]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([
        { login: 'claude-code', type: 'User' },
      ]);
    }

    if (value.endsWith('/users/claude-code')) {
      return Response.json({
        login: 'claude-code',
        type: 'User',
        name: 'Claude Code',
        html_url: 'https://github.com/claude-code',
      });
    }

    if (value.endsWith('/users/claude-code/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/claude-code') {
      return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo', {
      contributorFallbackLimit: 5,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Net' && !author.familyNames), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata includes co-authored contributor names from recent history when the newest commit has no co-author', async () => {
  const originalFetch = globalThis.fetch;

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

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=10&sha=main')) {
      return Response.json([
        {
          commit: {
            committer: { date: '2025-01-02T00:00:00Z' },
            message: 'Add link to event and data',
          },
        },
        {
          commit: {
            committer: { date: '2025-01-01T00:00:00Z' },
            message: 'Label Interface (#2)\n\nCo-authored-by: Net Zhang <zhang.11091@osu.edu>',
          },
        },
      ]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=1&sha=main')) {
      return Response.json([
        {
          commit: {
            committer: { date: '2025-01-02T00:00:00Z' },
            message: 'Add link to event and data',
          },
        },
      ]);
    }

    if (value.endsWith('/repos/test-owner/test-repo/branches/main')) {
      return Response.json({ name: 'main' });
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
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo', {
      contributorFallbackLimit: 5,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Net' && author.familyNames === 'Zhang'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('importGithubMetadata includes co-authored contributor names when a release already exists', async () => {
  const originalFetch = globalThis.fetch;

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
        tag_name: 'v1.0.0',
        published_at: '2025-01-03T00:00:00Z',
      });
    }

    if (value.endsWith('/repos/test-owner/test-repo/commits?per_page=10&sha=main')) {
      return Response.json([
        {
          commit: {
            committer: { date: '2025-01-02T00:00:00Z' },
            message: 'Implement feature\n\nCo-authored-by: Net Zhang <net@example.com>',
          },
        },
        {
          commit: {
            committer: { date: '2025-01-01T00:00:00Z' },
            message: 'Earlier feature\n\nCo-authored-by: Claude Fable 5 <claude@example.com>',
          },
        },
      ]);
    }

    if (value.includes('/repos/test-owner/test-repo/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (value.includes('/repos/test-owner/test-repo/contributors?')) {
      return Response.json([
        { login: 'claude-code', type: 'User' },
      ]);
    }

    if (value.endsWith('/users/claude-code')) {
      return Response.json({
        login: 'claude-code',
        type: 'User',
        name: 'Claude Code',
        html_url: 'https://github.com/claude-code',
      });
    }

    if (value.endsWith('/users/claude-code/social_accounts')) {
      return Response.json([]);
    }

    if (value === 'https://github.com/claude-code') {
      return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    throw new Error(`Unexpected fetch URL: ${value}`);
  };

  try {
    const result = await importGithubMetadata('https://github.com/test-owner/test-repo', {
      contributorFallbackLimit: 5,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Net' && author.familyNames === 'Zhang'), true);
    assert.equal(result.metadata.authors.some((author) => author.givenNames === 'Claude' && author.familyNames === 'Fable'), false);
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
