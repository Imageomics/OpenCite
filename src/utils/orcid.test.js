import test from 'node:test';
import assert from 'node:assert/strict';

import { extractOrcidFromGithubHtml, extractOrcidFromGithubProfile, extractOrcidFromText } from './orcid.js';
import { isValidOrcidFormat, normalizeOrcid } from './orcid.js';

test('normalizeOrcid canonicalizes http ORCID URLs to https', () => {
  assert.equal(
    normalizeOrcid('http://orcid.org/0000-0002-1825-0097'),
    'https://orcid.org/0000-0002-1825-0097',
  );
});

test('normalizeOrcid canonicalizes plain ORCID identifiers to https URLs', () => {
  assert.equal(
    normalizeOrcid('0000-0002-1694-233X'),
    'https://orcid.org/0000-0002-1694-233X',
  );
});

test('extractOrcidFromText normalizes ORCID URLs', () => {
  assert.equal(
    extractOrcidFromText('https://orcid.org/0000-0002-1825-0097'),
    'https://orcid.org/0000-0002-1825-0097',
  );
});

test('extractOrcidFromText accepts plain ORCID identifiers', () => {
  assert.equal(
    extractOrcidFromText('0000-0002-1694-233X'),
    'https://orcid.org/0000-0002-1694-233X',
  );
});

test('extractOrcidFromGithubProfile checks attached social links before profile text', () => {
  assert.equal(
    extractOrcidFromGithubProfile(
      {
        blog: 'https://example.org/profile',
        bio: 'Also reachable at 0000-0002-1694-233X',
      },
      [{ url: 'https://orcid.org/0000-0002-1825-0097' }],
    ),
    'https://orcid.org/0000-0002-1825-0097',
  );
});

test('extractOrcidFromGithubProfile scans nested attached link fields', () => {
  assert.equal(
    extractOrcidFromGithubProfile(
      {
        blog: 'https://example.org/profile',
        bio: 'Researcher in imageomics',
      },
      [{ provider: 'generic', metadata: { url: 'https://orcid.org/0000-0002-1825-0097' } }],
    ),
    'https://orcid.org/0000-0002-1825-0097',
  );
});

test('extractOrcidFromGithubProfile scans arbitrary profile string fields', () => {
  assert.equal(
    extractOrcidFromGithubProfile({
      blog: '',
      bio: '',
      note: 'Find me at orcid.org/0000-0002-1694-233X',
    }),
    'https://orcid.org/0000-0002-1694-233X',
  );
});

test('extractOrcidFromGithubProfile checks blog before bio when no social ORCID is present', () => {
  assert.equal(
    extractOrcidFromGithubProfile({
      blog: 'orcid.org/0000-0002-1825-0097',
      bio: 'Also reachable at 0000-0002-1694-233X',
    }),
    'https://orcid.org/0000-0002-1825-0097',
  );
});

test('extractOrcidFromGithubProfile returns null when no valid ORCID is present', () => {
  assert.equal(
    extractOrcidFromGithubProfile({
      blog: 'https://example.org/profile',
      bio: 'Researcher in imageomics',
    }),
    null,
  );
});

test('extractOrcidFromGithubHtml finds ORCID links in HTML markup', () => {
  assert.equal(
    extractOrcidFromGithubHtml('<a href="https://orcid.org/0000-0002-1825-0097">ORCID</a>'),
    'https://orcid.org/0000-0002-1825-0097',
  );
});

test('isValidOrcidFormat accepts ORCID identifiers with valid checksum', () => {
  assert.equal(isValidOrcidFormat('0000-0002-1825-0097'), true);
  assert.equal(isValidOrcidFormat('https://orcid.org/0000-0002-1694-233X'), true);
});

test('isValidOrcidFormat rejects ORCID identifiers with invalid checksum', () => {
  assert.equal(isValidOrcidFormat('0000-0002-1825-0098'), false);
});