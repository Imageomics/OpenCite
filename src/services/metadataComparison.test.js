import test from 'node:test';
import assert from 'node:assert/strict';

import { compareExistingMetadataFiles } from './metadataComparison.js';

function baseContext() {
  return {
    repoData: {
      html_url: 'https://github.com/imageomics/opencite',
      license: { spdx_id: 'GPL-3.0' },
      topics: ['citation', 'metadata'],
      description: 'OpenCite repository',
    },
    releaseData: {
      tag_name: 'v1.2.1',
      published_at: '2026-07-13T00:00:00Z',
    },
    contributorLookupAuthors: [
      { givenNames: 'Jane', familyNames: 'Doe' },
    ],
    fileValidationSummary: {
      citation: { present: true },
      zenodo: { present: false },
    },
    citationForComparison: {
      version: '1.0.0',
      repositoryCode: 'https://github.com/imageomics/old-name',
      publicationDate: '2026-07-01',
      license: 'MIT',
      authors: [{ name: 'Jane Doe' }],
      keywords: ['citation'],
      abstract: '',
      doi: '',
    },
    zenodoForComparison: null,
  };
}

test('compareExistingMetadataFiles returns expected statuses and recommendations', () => {
  const comparisons = compareExistingMetadataFiles(baseContext());

  const byField = new Map(comparisons.map((item) => [item.field, item]));

  assert.equal(byField.get('version')?.status, 'different');
  assert.equal(byField.get('version')?.recommendation, 'Update version to latest release.');

  assert.equal(byField.get('repository-code')?.status, 'different');
  assert.equal(byField.get('repository-code')?.recommendation, 'Repository was renamed. Update repository-code.');

  assert.equal(byField.get('license')?.status, 'different');
  assert.equal(byField.get('license')?.recommendation, 'Review repository license and align citation metadata if needed.');

  assert.equal(byField.get('abstract')?.status, 'missing');
  assert.equal(byField.get('doi')?.status, 'cannot determine');
});

test('compareExistingMetadataFiles marks identical fields correctly', () => {
  const context = baseContext();
  context.citationForComparison = {
    version: '1.2.1',
    repositoryCode: 'https://github.com/imageomics/opencite',
    publicationDate: '2026-07-13',
    license: 'GPL-3.0',
    authors: [{ givenNames: 'Jane', familyNames: 'Doe' }],
    keywords: ['citation', 'metadata'],
    abstract: 'OpenCite repository',
    doi: '10.0000/example',
  };

  const comparisons = compareExistingMetadataFiles(context);
  const deterministicFields = new Set([
    'version',
    'repository-code',
    'date-released',
    'license',
    'authors',
    'keywords',
    'abstract',
  ]);
  const comparable = comparisons.filter((item) => deterministicFields.has(item.field));

  assert.equal(comparable.every((item) => item.status === 'identical'), true);
});
