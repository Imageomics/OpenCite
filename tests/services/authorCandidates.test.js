import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAuthorCandidates, findMatchingAuthorIndex } from '../../src/services/githubImporterAuthorCandidates.js';
import { scanCommitHistory } from '../../src/services/githubImporterCommitAuthors.js';
import { resolveContributorSince, resolveContributorUntil } from '../../src/services/githubImporterContributors.js';
import { cleanString, normalizeAuthor } from '../../src/services/githubImporterUtils.js';

const contributor = (name, login, contributions, orcid = '') => ({ author: normalizeAuthor({ name, orcid }), login, contributions });
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

test('fallback author order follows contributor rank when names include initials', () => {
  const candidates = buildAuthorCandidates({
    contributorCandidates: [
      contributor('J. Doe', 'j-doe', 100),
      contributor('Ada Lovelace', 'ada', 50),
    ],
    autoCreditLimit: 2,
    normalizeAuthor,
  });

  assert.deepEqual(candidates.map(fullName), ['J Doe', 'Ada Lovelace']);
  assert.deepEqual(candidates.map((candidate) => candidate.autoSelected), [true, true]);
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
  assert.equal(resolveContributorSince('2025-02-30'), '');
  assert.equal(resolveContributorUntil('2025-02-30'), '');
});

test('findMatchingAuthorIndex treats a middle initial as the same person', () => {
  const authors = [
    { givenNames: 'Elizabeth G.', familyNames: 'Campolongo' },
    { givenNames: 'Matthew J.', familyNames: 'Thompson' },
  ];
  const candidate = (name) => ({ id: name.toLowerCase(), ...normalizeAuthor({ name }) });

  assert.equal(findMatchingAuthorIndex(authors, candidate('Elizabeth Campolongo')), 0);
  assert.equal(findMatchingAuthorIndex(authors, candidate('Matthew Thompson')), 1);
  assert.equal(findMatchingAuthorIndex(authors, candidate('Dana Example')), -1);
});

test('findMatchingAuthorIndex matches a full first name to an unambiguous initial', () => {
  const authors = [{ givenNames: 'J.', familyNames: 'Doe', orcid: '' }];

  assert.equal(findMatchingAuthorIndex(authors, normalizeAuthor({ name: 'Jane Doe' })), 0);
});

test('findMatchingAuthorIndex leaves an initial ambiguous between full namesakes', () => {
  const authors = [
    { givenNames: 'Jane', familyNames: 'Doe', orcid: '' },
    { givenNames: 'John', familyNames: 'Doe', orcid: '' },
  ];

  assert.equal(findMatchingAuthorIndex(authors, normalizeAuthor({ name: 'J. Doe' })), -1);
});

test('findMatchingAuthorIndex does not map multiple full-name candidates to one initial-only author', () => {
  const authors = [{ givenNames: 'J.', familyNames: 'Doe', orcid: '' }];
  const candidates = ['Jane Doe', 'John Doe'].map((name) => ({
    ...normalizeAuthor({ name }),
    id: name,
  }));

  assert.equal(findMatchingAuthorIndex(authors, candidates[0], candidates), -1);
  assert.equal(findMatchingAuthorIndex(authors, candidates[1], candidates), -1);
});

test('findMatchingAuthorIndex leaves an initial-only candidate ambiguous across the full candidate pool', () => {
  const candidates = ['Jane Doe', 'John Doe', 'J. Doe'].map((name) => ({
    ...normalizeAuthor({ name }),
    id: name,
  }));
  const authors = [candidates[0]];

  assert.equal(findMatchingAuthorIndex(authors, candidates[2], candidates), -1);
});

test('findMatchingAuthorIndex avoids matching different first names with the same initials', () => {
  const authors = [
    { givenNames: 'Jane', familyNames: 'Smith' },
    { givenNames: 'John', familyNames: 'Smith' },
  ];

  assert.equal(findMatchingAuthorIndex(authors, normalizeAuthor({ name: 'John Smith' })), 1);
});

test('candidate identities and matching keep namesakes with distinct ORCIDs separate', () => {
  const candidates = buildAuthorCandidates({
    contributorCandidates: [
      contributor('Alex Smith', 'alex-one', 5, 'https://orcid.org/0000-0001-1111-1111'),
      contributor('Alex Smith', 'alex-two', 4, 'https://orcid.org/0000-0002-2222-2222'),
    ],
    autoCreditLimit: 5,
    normalizeAuthor,
  });
  const authors = [
    { givenNames: 'Alex', familyNames: 'Smith', orcid: 'https://orcid.org/0000-0001-1111-1111' },
    { givenNames: 'Alex', familyNames: 'Smith', orcid: 'https://orcid.org/0000-0002-2222-2222' },
  ];

  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].id, candidates[1].id);
  assert.equal(findMatchingAuthorIndex(authors, candidates[1]), 1);
  assert.equal(findMatchingAuthorIndex(authors, normalizeAuthor({ name: 'Alex Smith' })), -1);
});

test('candidate matching normalizes bare and URL ORCIDs', () => {
  const authors = [{ givenNames: 'Jane', familyNames: 'Doe', orcid: '0000-0002-1825-0097' }];
  const candidate = {
    ...normalizeAuthor({ name: 'Jane Doe', orcid: 'https://orcid.org/0000-0002-1825-0097' }),
    id: 'jane-doe',
  };

  assert.equal(findMatchingAuthorIndex(authors, candidate, [candidate]), 0);
});

test('candidates with conflicting ORCIDs do not share an ORCID-less author selection', () => {
  const candidates = [
    { ...normalizeAuthor({ name: 'Alex Smith', orcid: '0000-0002-1825-0097' }), id: 'alex-one' },
    { ...normalizeAuthor({ name: 'Alex Smith', orcid: '0000-0002-1694-233X' }), id: 'alex-two' },
  ];
  const authors = [{ givenNames: 'Alex', familyNames: 'Smith', orcid: '' }];

  assert.equal(findMatchingAuthorIndex(authors, candidates[0], candidates), -1);
  assert.equal(findMatchingAuthorIndex(authors, candidates[1], candidates), -1);
});

test('an exact ORCID-less candidate matches its author despite identified namesakes', () => {
  const authors = [
    { givenNames: 'Alex', familyNames: 'Smith', orcid: 'https://orcid.org/0000-0001-1111-1111' },
    { givenNames: 'Alex', familyNames: 'Smith', orcid: 'https://orcid.org/0000-0002-2222-2222' },
    { givenNames: 'Alex', familyNames: 'Smith', orcid: '' },
  ];
  const candidates = [
    { ...normalizeAuthor({ name: 'Alex Smith', orcid: '0000-0001-1111-1111' }), id: 'alex-one' },
    { ...normalizeAuthor({ name: 'Alex Smith', orcid: '0000-0002-2222-2222' }), id: 'alex-two' },
    { ...normalizeAuthor({ name: 'Alex Smith' }), id: 'alex-unidentified' },
  ];

  assert.equal(findMatchingAuthorIndex(authors, candidates[2], candidates), 2);
});

test('candidate sources with middle-initial name variants merge', () => {
  const candidates = buildAuthorCandidates({
    contributorCandidates: [contributor('Elizabeth G. Campolongo', 'elizabeth', 3)],
    commitNames: [{ name: 'Elizabeth Campolongo', commits: 2, lastCommitDate: '' }],
    autoCreditLimit: 5,
    normalizeAuthor,
  });

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].sources, ['github-contributor', 'commit-history']);
});

test('abbreviated co-author names merge only when one full-name match exists', () => {
  const uniqueMatch = buildAuthorCandidates({
    coAuthorNames: ['J. Doe'],
    contributorCandidates: [contributor('Jane Doe', 'jane', 3)],
    autoCreditLimit: 5,
    normalizeAuthor,
  });

  assert.equal(uniqueMatch.length, 1);
  assert.equal(fullName(uniqueMatch[0]), 'Jane Doe');
  assert.deepEqual(uniqueMatch[0].sources, ['github-contributor', 'co-author']);

  const ambiguousMatches = buildAuthorCandidates({
    coAuthorNames: ['J. Doe'],
    contributorCandidates: [
      contributor('Jane Doe', 'jane', 3),
      contributor('John Doe', 'john', 2),
    ],
    autoCreditLimit: 5,
    normalizeAuthor,
  });

  assert.equal(ambiguousMatches.length, 3);
  assert.deepEqual(
    ambiguousMatches.map(({ givenNames, familyNames, sources }) => [`${givenNames} ${familyNames}`, sources]),
    [
      ['J Doe', ['co-author']],
      ['Jane Doe', ['github-contributor']],
      ['John Doe', ['github-contributor']],
    ]
  );
});

test('an end date alone or with a start date flags contributors outside the range', () => {
  const candidates = buildAuthorCandidates({
    contributorCandidates: [contributor('Early Author', 'early', 40), contributor('Late Author', 'late', 9)],
    loginCounts: new Map([['early', 3]]),
    since: '2020-01-01T00:00:00Z',
    until: '2021-12-31T23:59:59Z',
    autoCreditLimit: 5,
    normalizeAuthor,
  });

  assert.equal(candidates[0].autoSelected, true);
  assert.match(candidates[0].reason, /3 between 2020-01-01 and 2021-12-31/);
  assert.equal(candidates[1].autoSelected, false);
  assert.match(candidates[1].reason, /none found between 2020-01-01 and 2021-12-31/);

  const untilOnly = buildAuthorCandidates({
    contributorCandidates: [contributor('Late Author', 'late', 9)],
    until: '2021-12-31T23:59:59Z',
    autoCreditLimit: 5,
    normalizeAuthor,
  });
  assert.match(untilOnly[0].reason, /none found until 2021-12-31/);
});

test('commit scans send the until filter and an end date is inclusive of that day', async () => {
  const urls = [];
  await scanCommitHistory({
    owner: 'o', repo: 'r', defaultBranch: 'main', until: resolveContributorUntil('2021-12-31'),
    warnings: [], cleanString, addWarning: () => {},
    fetchOptionalJson: async (url) => { urls.push(url); return []; },
  });

  assert.deepEqual(urls, ['https://api.github.com/repos/o/r/commits?per_page=100&sha=main&until=2021-12-31T23%3A59%3A59Z']);
  assert.equal(resolveContributorUntil('not a date'), '');
});
