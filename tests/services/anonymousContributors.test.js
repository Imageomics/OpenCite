import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContributorAuthorInput, extractCoAuthorNamesFromCommitMessage, fetchContributorAuthors } from '../../src/services/githubImporterContributors.js';
import { buildGithubContributorsApiUrl } from '../../src/services/githubApi.js';
import { importGithubMetadata } from '../../src/services/githubImporter.js';
import { cleanString, normalizeAuthor, normalizeAuthors } from '../../src/services/githubImporterUtils.js';

test('anonymous humans and hyphenated names survive, but bots and handles do not', async () => {
  const contributorUrls = [];
  const result = await fetchContributorAuthors({
    owner: 'test-owner', repo: 'test-repo', warnings: [], contributorFallbackLimit: 10,
    cleanString, normalizeAuthor, normalizeAuthors, addWarning: () => {},
    fetchOptionalJson: async (url) => {
      if (url.includes('/contributors?')) {
        contributorUrls.push(url);
        assert.equal(new URL(url).searchParams.get('anon'), '1');
        return [
          { name: 'Anne-Marie', type: 'Anonymous' },
          { name: 'Dana Example', type: 'Anonymous' },
          { name: 'Anne-Marie Smith', type: 'Anonymous' },
          { name: 'Jane Smith-Jones', type: 'Anonymous' },
          { name: 'copilot-agent', type: 'Anonymous' },
          { name: 'jane-doe', type: 'Anonymous' },
          { name: 'anne-marie Smith', type: 'Anonymous' },
          { name: '@janedoe', type: 'Anonymous' },
          { name: 'Automation', type: 'Bot' },
        ];
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    extractOrcidFromGithubProfile: () => '',
  });
  assert.equal(contributorUrls.length, 1);
  assert.deepEqual(result.fallbackAuthors.map((author) => [author.givenNames, author.familyNames]), [
    ['', 'Anne-Marie'], ['Dana', 'Example'], ['Anne-Marie', 'Smith'], ['Jane', 'Smith-Jones'],
  ]);
});

test('GitHub-specific hyphen preservation leaves shared metadata normalization unchanged', () => {
  assert.equal(normalizeAuthor(buildContributorAuthorInput('Anne-Marie')).familyNames, 'Anne-Marie');
  assert.equal(normalizeAuthor({ name: 'Anne-Marie' }).familyNames, 'Marie');
  assert.equal(normalizeAuthor(buildContributorAuthorInput('jane-doe')).familyNames, 'Doe');
  assert.equal(normalizeAuthor({ name: 'Anne-Marie Smith' }).givenNames, 'Anne Marie');
});

test('contributor URL explicitly requests anonymous records and retains pagination', () => {
  const url = new URL(buildGithubContributorsApiUrl('owner', 'repo', 2, 50));
  assert.equal(url.searchParams.get('anon'), '1');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '50');
});

test('GitHub name input preserves qualifying hyphenated given and family tokens and enrichment', () => {
  const extra = { affiliation: 'Example Lab', orcid: 'https://orcid.org/0000-0002-1825-0097' };
  for (const [name, givenNames, familyNames] of [
    ['Anne-Marie Smith', 'Anne-Marie', 'Smith'],
    ['Jane Smith-Jones', 'Jane', 'Smith-Jones'],
    ['Anne-Marie Louise Smith-Jones', 'Anne-Marie Louise', 'Smith-Jones'],
    ['Smith-Jones, Anne-Marie Louise', 'Anne-Marie Louise', 'Smith-Jones'],
    ['  Anne-Marie   Smith  ', 'Anne-Marie', 'Smith'],
    ['Anne-Marie', '', 'Anne-Marie'],
  ]) {
    assert.deepEqual(normalizeAuthor(buildContributorAuthorInput(name, extra)), {
      givenNames, familyNames, ...extra,
    });
  }
});

test('co-author trailers preserve human hyphens while excluding handles and automated names', () => {
  const names = extractCoAuthorNamesFromCommitMessage([
    'Co-authored-by: Anne-Marie Smith <anne@example.test>',
    'Co-authored-by: Jane Smith-Jones <jane@example.test>',
    'Co-authored-by: jane-doe <handle@example.test>',
    'Co-authored-by: @janedoe <handle@example.test>',
    'Co-authored-by: bot-123 <bot@example.test>',
    'Co-authored-by: Claude Code <bot@example.test>',
    'Co-authored-by: GitHub Copilot <bot@example.test>',
  ].join('\n'));
  assert.deepEqual(names, ['Anne-Marie Smith', 'Jane Smith-Jones']);
  assert.deepEqual(names.map((name) => normalizeAuthor(buildContributorAuthorInput(name)).givenNames), ['Anne-Marie', 'Jane']);
});

test('hyphenated profile and co-author names survive the full importer pipeline', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/repos/owner/repo')) {
      return Response.json({ name: 'repo', default_branch: 'main', html_url: 'https://github.com/owner/repo' });
    }
    if (value.includes('/releases?')) return Response.json([{ tag_name: '1.0.0', published_at: '2026-01-01' }]);
    if (value.includes('/commits?')) {
      return Response.json([{ commit: { message:
        'Co-authored-by: Anne-Marie Smith <anne@example.test>\nCo-authored-by: jane-doe <handle@example.test>' } }]);
    }
    if (value.includes('/contributors?')) {
      assert.equal(new URL(value).searchParams.get('anon'), '1');
      return Response.json([
        { login: 'janesmith', type: 'User' },
        { name: 'Anne-Marie Smith', type: 'Anonymous' },
      ]);
    }
    if (value.endsWith('/users/janesmith')) {
      return Response.json({ login: 'janesmith', type: 'User', name: 'Jane Smith-Jones', company: 'Example Lab' });
    }
    if (value.endsWith('/users/janesmith/social_accounts')) return Response.json([]);
    throw new Error(`Unexpected URL: ${value}`);
  };
  try {
    const result = await importGithubMetadata('https://github.com/owner/repo', {
      inspectRepositoryFiles: false, lookupExternalDoi: false,
    });
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.some((warning) => warning.code === 'request-failed'), false);
    assert.deepEqual(result.metadata.authors.map((author) => [author.givenNames, author.familyNames]), [
      ['Anne-Marie', 'Smith'], ['Jane', 'Smith-Jones'],
    ]);
    assert.equal(result.metadata.authors[1].affiliation, 'Example Lab');
  } finally {
    globalThis.fetch = originalFetch;
  }
});