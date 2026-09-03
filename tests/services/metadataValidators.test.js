import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runMetadataValidators,
  validateAbstract,
  validateAuthors,
  validateDOI,
  validateKeywords,
  validateLicense,
  validateORCID,
  validateReleaseDate,
  validateRepositoryUrl,
  validateVersion,
} from '../../src/services/metadataValidators.js';

function buildContext() {
  return {
    repoData: {
      html_url: 'https://github.com/imageomics/opencite',
      license: { spdx_id: 'MIT' },
      topics: ['citation', 'metadata'],
      description: 'OpenCite metadata tool',
    },
    releaseData: {
      tag_name: 'v1.2.3',
      published_at: '2026-07-13T00:00:00Z',
    },
    contributorLookupAuthors: [
      { givenNames: 'Jane', familyNames: 'Doe' },
    ],
  };
}

test('individual validators return standardized ValidationResult shape', () => {
  const context = buildContext();
  const metadata = {
    version: '1.2.3',
    repositoryCode: 'https://github.com/imageomics/opencite',
    license: 'MIT',
    publicationDate: '2026-07-13',
    authors: [{ givenNames: 'Jane', familyNames: 'Doe', orcid: '' }],
    doi: '',
    keywords: ['citation', 'metadata'],
    abstract: 'OpenCite metadata tool',
  };

  const validators = [
    validateVersion,
    validateRepositoryUrl,
    validateLicense,
    validateReleaseDate,
    validateAuthors,
    validateORCID,
    validateDOI,
    validateKeywords,
    validateAbstract,
  ];

  for (const validator of validators) {
    const result = validator({ file: 'CITATION.cff', metadata, context });
    assert.equal(typeof result.file, 'string');
    assert.equal(typeof result.field, 'string');
    assert.equal(typeof result.status, 'string');
    assert.equal(typeof result.currentValue, 'string');
    assert.equal(typeof result.githubValue, 'string');
    assert.equal(typeof result.recommendation, 'string');
    assert.equal(['identical', 'different', 'missing', 'cannot determine'].includes(result.status), true);
  }
});

test('validateAuthors compares authors in family-name order', () => {
  const result = validateAuthors({
    file: 'CITATION.cff',
    metadata: {
      authors: [
        { givenNames: 'Zoe', familyNames: 'Adams' },
        { givenNames: 'Amy', familyNames: 'Brown' },
      ],
    },
    context: {
      contributorLookupAuthors: [
        { givenNames: 'Amy', familyNames: 'Brown' },
        { givenNames: 'Zoe', familyNames: 'Adams' },
      ],
    },
  });

  assert.equal(result.status, 'identical');
});

test('validateReleaseDate uses the local calendar date for GitHub timestamps', () => {
  const result = validateReleaseDate({
    file: 'CITATION.cff',
    metadata: { publicationDate: '2026-07-12' },
    context: { releaseData: { published_at: '2026-07-12T00:00:00Z' } },
  });

  const date = new Date('2026-07-12T00:00:00Z');
  const expectedDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  assert.equal(result.githubValue, expectedDate);
  assert.equal(result.status, expectedDate === '2026-07-12' ? 'identical' : 'different');
});

test('runMetadataValidators executes default registry and is easy to extend', () => {
  const context = buildContext();
  const metadata = {
    version: '0.1.0',
    repositoryCode: 'https://github.com/imageomics/old',
    license: 'GPL-3.0',
    publicationDate: '2025-01-01',
    authors: [],
    doi: '',
    keywords: [],
    abstract: '',
  };

  const results = runMetadataValidators({ file: 'CITATION.cff', metadata, context });
  assert.equal(results.length >= 9, true);

  const custom = runMetadataValidators({
    file: 'CITATION.cff',
    metadata,
    context,
    validators: [
      () => ({
        file: 'CITATION.cff',
        field: 'custom',
        status: 'cannot determine',
        currentValue: '',
        githubValue: '',
        recommendation: 'Custom validator works.',
      }),
    ],
  });

  assert.deepEqual(custom, [{
    file: 'CITATION.cff',
    field: 'custom',
    status: 'cannot determine',
    currentValue: '',
    githubValue: '',
    recommendation: 'Custom validator works.',
  }]);
});
