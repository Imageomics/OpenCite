import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchContributorAuthors, resolveContributorFallbackLimit } from '../../src/services/githubImporterContributors.js';
import { cleanString, normalizeAuthor, normalizeAuthors } from '../../src/services/githubImporterUtils.js';

test('fallback fills human slots across a bot-only page without using login-only names', async () => {
  const urls = [];
  const warnings = [];
  const result = await fetchContributorAuthors({
    owner: 'test-owner', repo: 'test-repo', warnings, contributorFallbackLimit: 2,
    cleanString, normalizeAuthor, normalizeAuthors,
    addWarning: (items, source, code, message) => items.push({ source, code, message }),
    fetchOptionalJson: async (url) => {
      urls.push(url);
      if (url.endsWith('&page=1')) {
        return Array.from({ length: 100 }, (_, index) => ({ login: `bot-${index}`, type: 'Bot' }));
      }
      if (url.endsWith('&page=2')) {
        return [
          { login: 'no-name', type: 'User', contributions: 5 },
          { login: 'alice', type: 'User', contributions: 4 },
          { login: 'bob', type: 'User', contributions: 3 },
        ];
      }
      if (url.endsWith('/users/no-name')) return { login: 'no-name', name: 'no-name', type: 'User' };
      if (url.endsWith('/users/alice')) return { login: 'alice', name: 'Alice Example', type: 'User' };
      if (url.endsWith('/users/bob')) return { login: 'bob', name: 'Bob Example', type: 'User' };
      throw new Error(`Unexpected URL: ${url}`);
    },
    extractOrcidFromGithubProfile: () => '',
  });
  assert.equal(urls.some((url) => url.endsWith('&page=2')), true);
  assert.deepEqual(result.fallbackAuthors.map((author) => `${author.givenNames} ${author.familyNames}`), [
    'Alice Example', 'Bob Example',
  ]);
  assert.equal(warnings.some((warning) => warning.code === 'automated-contributors-excluded'), true);
});

test('unauthenticated fallback caps profile requests at 25', async () => {
  let profileRequests = 0;
  const result = await fetchContributorAuthors({
    owner: 'test-owner', repo: 'test-repo', warnings: [], contributorFallbackLimit: 50,
    cleanString, normalizeAuthor, normalizeAuthors, addWarning: () => {},
    fetchOptionalJson: async (url) => {
      if (url.includes('/contributors?')) {
        return Array.from({ length: 100 }, (_, index) => ({ login: `person-${index}`, type: 'User' }));
      }
      if (url.includes('/users/person-')) {
        profileRequests += 1;
        return { name: `Person ${String.fromCharCode(64 + profileRequests)}`, type: 'User' };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    extractOrcidFromGithubProfile: () => '',
  });
  assert.equal(profileRequests, 25);
  assert.equal(result.fallbackAuthors.length, 25);
  assert.equal(resolveContributorFallbackLimit({ contributorFallbackLimit: 500 }), 50);
});