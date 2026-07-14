import test from 'node:test';
import assert from 'node:assert/strict';

import { runMetadataReviewPipeline } from './metadataReview.js';

test('runMetadataReviewPipeline recommends keep when files are valid and no consistency issues', () => {
  const review = runMetadataReviewPipeline({
    warnings: [],
    fileValidationSummary: {
      citation: { present: true, valid: true, path: 'CITATION.cff', errors: [] },
      zenodo: { present: true, valid: true, path: '.zenodo.json', errors: [] },
    },
  });

  assert.equal(review.summary.byStatus.correct >= 2, true);
  assert.equal(review.recommendations.canKeepCurrentFiles, true);
  assert.equal(review.recommendations.canUpdateSpecificFields, false);
});

test('runMetadataReviewPipeline recommends regenerate for invalid citation file', () => {
  const review = runMetadataReviewPipeline({
    warnings: [],
    fileValidationSummary: {
      citation: {
        present: true,
        valid: false,
        path: 'CITATION.cff',
        errors: ['version is required.'],
      },
      zenodo: { present: true, valid: true, path: '.zenodo.json', errors: [] },
    },
  });

  assert.equal(review.recommendations.shouldGenerateNewFiles, true);
  assert.equal(review.recommendations.citationNeedsRegenerate, true);
  assert.equal(
    review.findings.some((finding) => finding.status === 'invalid' && finding.file === 'CITATION.cff'),
    true,
  );
});

test('runMetadataReviewPipeline recommends update fields for consistency mismatches', () => {
  const review = runMetadataReviewPipeline({
    warnings: [
      {
        code: 'version-mismatch',
        source: 'citation',
        message: 'CITATION.cff version differs from latest release tag.',
      },
      {
        code: 'repository-url-mismatch',
        source: 'citation',
        message: 'CITATION.cff repository-code differs from repository URL.',
      },
    ],
    fileValidationSummary: {
      citation: { present: true, valid: true, path: 'CITATION.cff', errors: [] },
      zenodo: { present: true, valid: true, path: '.zenodo.json', errors: [] },
    },
  });

  assert.equal(review.recommendations.canKeepCurrentFiles, false);
  assert.equal(review.recommendations.canUpdateSpecificFields, true);
  assert.equal(
    review.findings.some((finding) => finding.status === 'outdated' && finding.action === 'update-field'),
    true,
  );
});
