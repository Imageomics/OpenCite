import test from 'node:test';
import assert from 'node:assert/strict';

import {
  removeAuthorTouchedFields,
  swapAuthorTouchedFields,
} from '../../src/utils/authorTouchedFields.js';

test('removing an author removes their touched fields and shifts later authors', () => {
  const touched = {
    title: true,
    authors: true,
    'authors.0.orcid': true,
    'authors.1.orcid': true,
    'authors.2.familyNames': true,
  };

  assert.deepEqual(removeAuthorTouchedFields(touched, 1), {
    title: true,
    authors: true,
    'authors.0.orcid': true,
    'authors.1.familyNames': true,
  });
});

test('reordering authors moves their touched fields with them', () => {
  const touched = {
    authors: true,
    'authors.0.orcid': true,
    'authors.1.familyNames': true,
  };

  assert.deepEqual(swapAuthorTouchedFields(touched, 0, 1), {
    authors: true,
    'authors.0.familyNames': true,
    'authors.1.orcid': true,
  });
});
