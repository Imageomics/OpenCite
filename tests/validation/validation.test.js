import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFormInput, validateMetadata } from '../../src/validation/validation.js';

const typeOptions = [
  { value: 'article', label: 'Article' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'software', label: 'Software' },
  { value: 'other', label: 'Other' },
];

function createBaseForm() {
  return {
    title: 'OpenCite',
    authors: [
      {
        givenNames: 'Jane',
        familyNames: 'Doe',
        orcid: 'https://orcid.org/0000-0002-1825-0097',
        affiliation: 'Imageomics',
      },
    ],
    license: 'MIT',
    keywords: 'metadata, citation',
    typeOfWork: 'software',
    customTypeOfWork: '',
    version: '1.2.3',
    publicationDate: '2026-07-29',
    repositoryCode: 'https://github.com/imageomics/OpenCite',
    doi: '',
    abstract: 'Metadata utility.',
    references: '',
    grants: '021nxhr62::2118240',
  };
}

test('validateMetadata flags duplicate authors by normalized name', () => {
  const form = createBaseForm();
  form.authors.push({
    givenNames: 'jane',
    familyNames: 'doe',
    orcid: '',
    affiliation: '',
  });

  const normalized = normalizeFormInput(form);
  const errors = validateMetadata(normalized, typeOptions);

  assert.match(String(errors.authors ?? ''), /Duplicate author entries found/i);
  assert.match(String(errors.authors ?? ''), /1, 2/);
});

test('validateMetadata flags duplicate authors by ORCID even when names differ', () => {
  const form = createBaseForm();
  form.authors.push({
    givenNames: 'J.',
    familyNames: 'Doe',
    orcid: '0000-0002-1825-0097',
    affiliation: '',
  });

  const normalized = normalizeFormInput(form);
  const errors = validateMetadata(normalized, typeOptions);

  assert.match(String(errors.authors ?? ''), /Duplicate author entries found/i);
  assert.match(String(errors.authors ?? ''), /1, 2/);
});

test('validateMetadata accepts distinct authors', () => {
  const form = createBaseForm();
  form.authors.push({
    givenNames: 'John',
    familyNames: 'Smith',
    orcid: 'https://orcid.org/0000-0003-1415-9267',
    affiliation: '',
  });

  const normalized = normalizeFormInput(form);
  const errors = validateMetadata(normalized, typeOptions);

  assert.equal('authors' in errors, false);
});
