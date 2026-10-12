import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchCommitAuthors } from '../../src/services/githubImporterCommitAuthors.js';
import { cleanString, normalizeAuthor, normalizeAuthors } from '../../src/services/githubImporterUtils.js';

function commit(name, login = '') {
  return { commit: { author: { name } }, author: login ? { login, type: 'User' } : null };
}

test('authenticated scans continue to page two for human author names', async () => {
  const urls = [];
  const warnings = [];
  const result = await fetchCommitAuthors({
    owner: 'test-owner', repo: 'test-repo', defaultBranch: 'feature/new', authToken: 'token',
    initialCommits: Array.from({ length: 100 }, () => commit('known-login')),
    knownGithubLogins: ['known-login'], warnings,
    cleanString, normalizeAuthor, normalizeAuthors,
    addWarning: (items, source, code) => items.push({ source, code }),
    fetchOptionalJson: async (url) => {
      urls.push(url);
      return [commit('Ada Lovelace'), commit('bot-123'), commit('name-handle'), commit('Alice Example', 'Alice Example')];
    },
  });
  assert.equal(urls.length, 1);
  assert.equal(urls[0].endsWith('commits?per_page=100&sha=feature%2Fnew&page=2'), true);
  assert.deepEqual(result.map((author) => `${author.givenNames} ${author.familyNames}`), ['Ada Lovelace']);
  assert.equal(warnings.length, 0);
});

test('unauthenticated scans stop after the first 100 commits', async () => {
  const warnings = [];
  const result = await fetchCommitAuthors({
    owner: 'test-owner', repo: 'test-repo', initialCommits: Array.from({ length: 100 }, () => commit('Dana Example')),
    warnings, cleanString, normalizeAuthor, normalizeAuthors,
    addWarning: (items, source, code) => items.push({ source, code }),
    fetchOptionalJson: async () => { throw new Error('Should not request another page'); },
  });
  assert.equal(result.length, 1);
  assert.equal(warnings.some((warning) => warning.code === 'commit-author-scan-limited'), true);
});