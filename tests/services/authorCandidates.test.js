import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAuthorCandidates } from '../../src/services/githubImporterAuthorCandidates.js';
import { scanCommitHistory } from '../../src/services/githubImporterCommitAuthors.js';
import { resolveContributorSince } from '../../src/services/githubImporterContributors.js';
import { cleanString, normalizeAuthor } from '../../src/services/githubImporterUtils.js';

const contributor = (name, login, contributions) => ({ author: normalizeAuthor({ name }), login, contributions });
const fullName = (candidate) => `${candidate.givenNames} ${candidate.familyNames}`;

test('only the top contributors up to the limit are credited automatically', () => {
  const candidates = buildAuthorCandidates({
    contributorCandidates: [
      contributor('Ada Lovelace', 'ada', 50),
      contributor('Grace Hopper', 'grace', 20),
      contributor('Alan Turing', 'alan', 5),
    ],
    autoCreditLimit: 2,
    normalizeAuthor,
  });

  assert.deepEqual(candidates.map((candidate) => [fullName(candidate), candidate.autoSelected]), [
    ['Ada Lovelace', true],
    ['Grace Hopper', true],
    ['Alan Turing', false],
  ]);
  assert.match(candidates[0].reason, /GitHub contributor @ada · 50 commits/);
});

test('a cutoff skips contributors with no commits in the window and explains why', () => {
  const candidates = buildAuthorCandidates({
    contributorCandidates: [contributor('Old Maintainer', 'old', 900), contributor('New Author', 'new', 12)],
    loginCounts: new Map([['new', 7]]),
    since: '2025-01-01T00:00:00Z',
    autoCreditLimit: 5,
    normalizeAuthor,
  });

  const [old, recent] = candidates;
  assert.equal(old.autoSelected, false);
  assert.match(old.reason, /none found since 2025-01-01/);
  assert.equal(recent.autoSelected, true);
  assert.match(recent.reason, /7 since 2025-01-01/);
});

test('commit-history names are candidates but never credited automatically, and merge with contributors', () => {
  const candidates = buildAuthorCandidates({
    contributorCandidates: [contributor('Ada Lovelace', 'ada', 3)],
    commitNames: [
      { name: 'Ada Lovelace', commits: 4, lastCommitDate: '2026-02-03T10:00:00Z' },
      { name: 'Dana Example', commits: 2, lastCommitDate: '' },
    ],
    coAuthorNames: ['Pair Partner'],
    autoCreditLimit: 5,
    normalizeAuthor,
  });

  const byName = Object.fromEntries(candidates.map((candidate) => [fullName(candidate), candidate]));
  assert.deepEqual(byName['Ada Lovelace'].sources, ['github-contributor', 'commit-history']);
  assert.equal(byName['Dana Example'].autoSelected, false);
  assert.equal(byName['Pair Partner'].autoSelected, true);
  assert.equal(candidates.length, 3);
});

test('commit scans with a cutoff request the filtered first page and count logins', async () => {
  const urls = [];
  const result = await scanCommitHistory({
    owner: 'o', repo: 'r', defaultBranch: 'main', since: '2025-01-01T00:00:00Z',
    initialCommits: [{ commit: { author: { name: 'Ignored Unfiltered' } }, author: { login: 'ignored', type: 'User' } }],
    warnings: [], cleanString, addWarning: () => {},
    fetchOptionalJson: async (url) => {
      urls.push(url);
      return [
        { commit: { author: { name: 'Ada Lovelace', date: '2026-01-02T00:00:00Z' } }, author: { login: 'ada', type: 'User' } },
        { commit: { author: { name: 'Ada Lovelace', date: '2026-03-04T00:00:00Z' } }, author: { login: 'ada', type: 'User' } },
      ];
    },
  });

  assert.deepEqual(urls, ['https://api.github.com/repos/o/r/commits?per_page=100&sha=main&since=2025-01-01T00%3A00%3A00Z']);
  assert.equal(result.loginCounts.get('ada'), 2);
  assert.deepEqual(result.names.map(({ name, commits, lastCommitDate }) => [name, commits, lastCommitDate]), [
    ['Ada Lovelace', 2, '2026-03-04T00:00:00Z'],
  ]);
});

test('resolveContributorSince accepts dates and rejects garbage', () => {
  assert.equal(resolveContributorSince('2025-06-01'), '2025-06-01T00:00:00Z');
  assert.equal(resolveContributorSince(''), '');
  assert.equal(resolveContributorSince('not a date'), '');
});
