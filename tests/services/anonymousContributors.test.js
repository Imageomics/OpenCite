import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContributorAuthorInput, fetchContributorAuthors } from '../../src/services/githubImporterContributors.js';
import { cleanString, normalizeAuthor, normalizeAuthors } from '../../src/services/githubImporterUtils.js';

test('anonymous humans and hyphenated names survive, but bots and handles do not', async () => {
  const result = await fetchContributorAuthors({
    owner: 'test-owner', repo: 'test-repo', warnings: [], contributorFallbackLimit: 5,
    cleanString, normalizeAuthor, normalizeAuthors, addWarning: () => {},
    fetchOptionalJson: async (url) => {
      if (url.includes('/contributors?')) {
        return [
          { name: 'Anne-Marie', type: 'Anonymous' },
          { name: 'Dana Example', type: 'Anonymous' },
          { name: 'copilot-agent', type: 'Anonymous' },
          { name: 'jane-doe', type: 'Anonymous' },
          { name: 'Automation', type: 'Bot' },
        ];
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    extractOrcidFromGithubProfile: () => '',
  });
  assert.deepEqual(result.fallbackAuthors.map((author) => author.familyNames), ['Anne-Marie', 'Example']);
});

test('GitHub-specific hyphen preservation leaves shared metadata normalization unchanged', () => {
  assert.equal(normalizeAuthor(buildContributorAuthorInput('Anne-Marie')).familyNames, 'Anne-Marie');
  assert.equal(normalizeAuthor({ name: 'Anne-Marie' }).familyNames, 'Marie');
  assert.equal(normalizeAuthor(buildContributorAuthorInput('jane-doe')).familyNames, 'Doe');
});