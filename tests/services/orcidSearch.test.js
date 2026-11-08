import assert from 'node:assert/strict';
import test from 'node:test';

import {
  affiliationLooksSimilar,
  buildOrcidQuery,
  createOrcidLookupController,
  pickPreferredOrcidCandidate,
  searchOrcidCandidates,
} from '../../src/services/orcidSearch.js';

test('ORCID query does not require the affiliation to match', () => {
  const query = buildOrcidQuery({
    givenNames: 'Elizabeth',
    familyNames: 'Campolongo',
    affiliation: '@Imageomics, @ABC, @FAIR4AI-Bio',
  });

  assert.equal(query, 'given-names:"Elizabeth" AND family-name:"Campolongo"');
});

test('affiliation matching handles GitHub company lists', () => {
  assert.equal(affiliationLooksSimilar('@Imageomics, @ABC', 'Imageomics Institute'), true);
  assert.equal(affiliationLooksSimilar('@Imageomics, @ABC', 'Ohio State University'), false);
  assert.equal(affiliationLooksSimilar('', 'Ohio State University'), false);
  assert.equal(affiliationLooksSimilar('University of California, Berkeley', 'University of California, Los Angeles'), false);
});

test('search ranks candidates using every returned ORCID affiliation', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        'expanded-result': [
          { 'orcid-id': '0000-0000-0000-0001', 'given-names': 'Elizabeth', 'family-names': 'Campolongo', 'institution-name': ['Elsewhere'] },
          {
            'orcid-id': '0000-0000-0000-0002',
            'given-names': 'Elizabeth',
            'family-names': 'Campolongo',
            'institution-name': ['Previous University', 'Imageomics Institute'],
          },
        ],
      }),
    };
  };

  try {
    const author = { givenNames: 'Elizabeth', familyNames: 'Campolongo', affiliation: '@Imageomics, @ABC' };
    const candidates = await searchOrcidCandidates(author);

    assert.ok(!decodeURIComponent(requestedUrl).includes('affiliation-org-name'));
    assert.equal(candidates[0].orcid, 'https://orcid.org/0000-0000-0000-0002');
    assert.deepEqual(candidates[0].affiliations, ['Previous University', 'Imageomics Institute']);
    assert.equal(pickPreferredOrcidCandidate(author, candidates)?.orcid, 'https://orcid.org/0000-0000-0000-0002');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shared parent affiliations do not automatically select a different campus', () => {
  const author = {
    givenNames: 'Elizabeth',
    familyNames: 'Campolongo',
    affiliation: 'University of California, Berkeley',
  };
  const candidates = [
    {
      orcid: 'https://orcid.org/0000-0000-0000-0001',
      givenNames: 'Elizabeth',
      familyNames: 'Campolongo',
      affiliations: ['University of California, Los Angeles'],
    },
    {
      orcid: 'https://orcid.org/0000-0000-0000-0002',
      givenNames: 'Elizabeth',
      familyNames: 'Campolongo',
      affiliations: ['University of California, San Diego'],
    },
  ];

  assert.equal(pickPreferredOrcidCandidate(author, candidates), null);
});

test('ORCID lookup can be disabled, aborts pending requests, and can be re-enabled', async () => {
  const originalFetch = globalThis.fetch;
  const lookup = createOrcidLookupController();
  const author = { givenNames: 'Elizabeth', familyNames: 'Campolongo' };
  let requests = 0;
  globalThis.fetch = (url, { signal }) => {
    requests += 1;
    if (requests === 1) {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }

    return Promise.resolve({ ok: true, json: async () => ({ 'expanded-result': [] }) });
  };

  try {
    const generation = lookup.generation;
    const pending = lookup.search(author);
    lookup.setEnabled(false);
    await assert.rejects(pending, /aborted/);
    assert.equal(lookup.enabled, false);
    assert.notEqual(lookup.generation, generation);
    await assert.rejects(lookup.search(author), /disabled/);
    assert.equal(requests, 1);

    lookup.setEnabled(true);
    assert.deepEqual(await lookup.search(author), []);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
