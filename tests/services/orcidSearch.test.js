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
  assert.equal(affiliationLooksSimilar('Imageomics, ABC', 'ABC'), true);
  assert.equal(affiliationLooksSimilar('@Imageomics, @ABC', 'Ohio State University'), false);
  assert.equal(affiliationLooksSimilar('', 'Ohio State University'), false);
  assert.equal(affiliationLooksSimilar('University of California, Berkeley', 'University of California, Los Angeles'), false);
  assert.equal(affiliationLooksSimilar('University of California, Berkeley', 'Berkeley Institute'), false);
  assert.equal(affiliationLooksSimilar('University of California, Berkeley', 'Berkeley'), false);
  assert.equal(affiliationLooksSimilar('University of California, Berkeley', 'California'), false);
  assert.equal(affiliationLooksSimilar('Harvard University, Google', 'Harvard University'), true);
  assert.equal(affiliationLooksSimilar('Harvard University, Google', 'Google'), true);
  assert.equal(affiliationLooksSimilar('Google, London', 'University College London'), false);
  assert.equal(affiliationLooksSimilar('東京大学', '京都大学'), false);
  assert.equal(affiliationLooksSimilar('Harvard University, Massachusetts Institute of Technology', 'Massachusetts Institute of Technology'), true);
  assert.equal(affiliationLooksSimilar('The Ohio State University', 'Ohio State University'), true);
  assert.equal(affiliationLooksSimilar('Ohio State University', 'The Ohio State University'), true);
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

test('a later ORCID affiliation can rank a candidate into the top five', async () => {
  const originalFetch = globalThis.fetch;
  const results = Array.from({ length: 5 }, (_, index) => ({
    'orcid-id': `0000-0000-0000-000${index + 1}`,
    'given-names': 'Elizabeth',
    'family-names': 'Campolongo',
    'institution-name': ['Elsewhere'],
  }));
  results.push({
    'orcid-id': '0000-0000-0000-0006',
    'given-names': 'Elizabeth',
    'family-names': 'Campolongo',
    'institution-name': ['Previous University', 'Imageomics Institute'],
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ 'expanded-result': results }),
  });

  try {
    const candidates = await searchOrcidCandidates({
      givenNames: 'Elizabeth',
      familyNames: 'Campolongo',
      affiliation: '@Imageomics, @ABC',
    });

    assert.equal(candidates.length, 5);
    assert.equal(candidates[0].orcid, 'https://orcid.org/0000-0000-0000-0006');
    assert.deepEqual(candidates[0].affiliations, ['Previous University', 'Imageomics Institute']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exact-name matches remain available when affiliation-matching partial names exceed five', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      'expanded-result': [
        ...Array.from({ length: 4 }, (_, index) => ({
          'orcid-id': `0000-0000-0000-000${index + 1}`,
          'given-names': `Elizabeth ${index + 1}`,
          'family-names': 'Campolongo',
          'institution-name': ['Imageomics Institute'],
        })),
        {
          'orcid-id': '0000-0000-0000-0005',
          'given-names': 'Elizabeth',
          'family-names': 'Campolongo',
          'institution-name': ['Elsewhere'],
        },
        {
          'orcid-id': '0000-0000-0000-0006',
          'given-names': 'Elizabeth',
          'family-names': 'Campolongo',
          'institution-name': ['Another Institute'],
        },
      ],
    }),
  });

  try {
    const author = {
      givenNames: 'Elizabeth',
      familyNames: 'Campolongo',
      affiliation: 'Imageomics',
    };
    const candidates = await searchOrcidCandidates(author);

    assert.equal(candidates.length, 5);
    assert.deepEqual(candidates.slice(0, 2).map((candidate) => candidate.orcid), [
      'https://orcid.org/0000-0000-0000-0005',
      'https://orcid.org/0000-0000-0000-0006',
    ]);
    assert.equal(pickPreferredOrcidCandidate(author, candidates), null);
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

test('ambiguous location suffixes do not automatically select an ORCID candidate', () => {
  const author = {
    givenNames: 'Elizabeth',
    familyNames: 'Campolongo',
    affiliation: 'Google, London',
  };
  const candidates = [
    {
      orcid: 'https://orcid.org/0000-0000-0000-0001',
      givenNames: 'Elizabeth',
      familyNames: 'Campolongo',
      affiliations: ['University College London'],
    },
    {
      orcid: 'https://orcid.org/0000-0000-0000-0002',
      givenNames: 'Elizabeth',
      familyNames: 'Campolongo',
      affiliations: ['Another Institute'],
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
