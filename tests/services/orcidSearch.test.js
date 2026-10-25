import assert from 'node:assert/strict';
import test from 'node:test';

import {
  affiliationLooksSimilar,
  buildOrcidQuery,
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
});

test('search finds the ORCID despite a non-matching company and ranks affiliation matches first', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        'expanded-result': [
          { 'orcid-id': '0000-0000-0000-0001', 'given-names': 'Elizabeth', 'family-names': 'Campolongo', 'institution-name': ['Elsewhere'] },
          { 'orcid-id': '0000-0000-0000-0002', 'given-names': 'Elizabeth', 'family-names': 'Campolongo', 'institution-name': ['Imageomics Institute'] },
        ],
      }),
    };
  };

  try {
    const author = { givenNames: 'Elizabeth', familyNames: 'Campolongo', affiliation: '@Imageomics, @ABC' };
    const candidates = await searchOrcidCandidates(author);

    assert.ok(!decodeURIComponent(requestedUrl).includes('affiliation-org-name'));
    assert.equal(candidates[0].orcid, 'https://orcid.org/0000-0000-0000-0002');
    assert.equal(pickPreferredOrcidCandidate(author, candidates)?.orcid, 'https://orcid.org/0000-0000-0000-0002');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
