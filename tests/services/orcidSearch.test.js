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
        'num-found': 2,
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
    const { suggestions: candidates, preferred } = await searchOrcidCandidates(author);

    assert.ok(!decodeURIComponent(requestedUrl).includes('affiliation-org-name'));
    assert.equal(candidates[0].orcid, 'https://orcid.org/0000-0000-0000-0002');
    assert.deepEqual(candidates[0].affiliations, ['Previous University', 'Imageomics Institute']);
    assert.equal(preferred?.orcid, 'https://orcid.org/0000-0000-0000-0002');
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
    json: async () => ({ 'num-found': results.length, 'expanded-result': results }),
  });

  try {
    const { suggestions: candidates } = await searchOrcidCandidates({
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

test('finds and selects an affiliation match beyond the first 20 name results', async () => {
  const originalFetch = globalThis.fetch;
  const results = Array.from({ length: 65 }, (_, index) => ({
    'orcid-id': `other-${index}`,
    'given-names': 'Matthew',
    'family-names': 'Thompson',
    'institution-name': [],
  }));
  results.push({
    'orcid-id': '0000-0003-0583-8585',
    'given-names': 'Matthew',
    'family-names': 'Thompson',
    'institution-name': ['Purdue University', 'Imageomics Institute'],
  });
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url);
    return { ok: true, json: async () => ({ 'num-found': results.length, 'expanded-result': results }) };
  };

  try {
    const result = await searchOrcidCandidates({
      givenNames: 'Matthew',
      familyNames: 'Thompson',
      affiliation: 'Imageomics',
    });

    assert.equal(requestedUrl.searchParams.get('rows'), '1000');
    assert.equal(result.suggestions.length, 5);
    assert.equal(result.suggestions[0].orcid, 'https://orcid.org/0000-0003-0583-8585');
    assert.equal(result.preferred?.orcid, 'https://orcid.org/0000-0003-0583-8585');
    assert.equal(result.incomplete, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not auto-select when an affiliation match is hidden beyond five suggestions', async () => {
  const originalFetch = globalThis.fetch;
  const results = Array.from({ length: 6 }, (_, index) => ({
    'orcid-id': `candidate-${index}`,
    'given-names': 'Jane',
    'family-names': 'Doe',
    'institution-name': ['Imageomics Institute'],
  }));
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ 'num-found': results.length, 'expanded-result': results }),
  });

  try {
    const result = await searchOrcidCandidates({
      givenNames: 'Jane',
      familyNames: 'Doe',
      affiliation: 'Imageomics',
    });
    assert.equal(result.suggestions.length, 5);
    assert.equal(result.preferred, null);
    assert.equal(result.incomplete, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not auto-select when search results are incomplete', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      'num-found': 1001,
      'expanded-result': [{
        'orcid-id': '0000-0003-0583-8585',
        'given-names': 'Matthew',
        'family-names': 'Thompson',
        'institution-name': ['Imageomics Institute'],
      }],
    }),
  });

  try {
    const result = await searchOrcidCandidates({
      givenNames: 'Matthew',
      familyNames: 'Thompson',
      affiliation: 'Imageomics',
    });
    assert.equal(result.suggestions.length, 1);
    assert.equal(result.preferred, null);
    assert.equal(result.incomplete, true);
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
      'num-found': 6,
    }),
  });

  try {
    const author = {
      givenNames: 'Elizabeth',
      familyNames: 'Campolongo',
      affiliation: 'Imageomics',
    };
    const { suggestions: candidates, preferred } = await searchOrcidCandidates(author);

    assert.equal(candidates.length, 5);
    assert.deepEqual(candidates.slice(0, 2).map((candidate) => candidate.orcid), [
      'https://orcid.org/0000-0000-0000-0005',
      'https://orcid.org/0000-0000-0000-0006',
    ]);
    assert.equal(preferred, null);
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

    return Promise.resolve({ ok: true, json: async () => ({ 'num-found': 0, 'expanded-result': [] }) });
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
    assert.deepEqual(await lookup.search(author), { suggestions: [], preferred: null, incomplete: false });
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
