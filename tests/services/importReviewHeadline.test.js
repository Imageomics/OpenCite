import test from 'node:test';
import assert from 'node:assert/strict';

import { importReviewHeadline } from '../../src/services/importReviewHeadline.js';

test('review headlines count their own category rather than import and validation together', () => {
  const status = { errors: [{ message: 'Import failed' }], warnings: [{ message: 'Missing file' }] };
  assert.equal(importReviewHeadline(status, 2), 'Review findings (2)');
  assert.equal(importReviewHeadline(status, 0), 'Import errors (1)');
  assert.equal(importReviewHeadline({ errors: [], warnings: status.warnings }, 0), 'Import warnings (1)');
  assert.equal(importReviewHeadline({ errors: [], warnings: [] }, 0), 'No health or comparison findings');
});