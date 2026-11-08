import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFormInput, validateMetadata } from '../../src/validation/validation.js';
import { normalizeMetadata } from '../../src/metadata/normalizeMetadata.js';
import { updateMetadataField } from '../../src/metadata/updateMetadataField.js';
import { toCitationCff } from '../../src/services/citation.js';

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

test('release tag survives form normalization and is used in citation identifiers', () => {
  const form = {
    ...createBaseForm(),
    releaseTag: ' v1.2.3 ',
    releaseCommit: '0123456789abcdef0123456789abcdef01234567',
  };
  const metadata = normalizeMetadata(normalizeFormInput(form));
  assert.equal(metadata.releaseTag, 'v1.2.3');
  assert.equal(metadata.version, '1.2.3');
  assert.match(toCitationCff(metadata), /releases\/tag\/v1\.2\.3/);
  assert.match(toCitationCff(metadata), /commit tagged with v1\.2\.3/);
});

test('editing release identity clears stale tag and commit fields', () => {
  const form = { version: '1.2.3', repositoryCode: 'https://github.com/a/b', releaseTag: 'v1.2.3', releaseCommit: 'abcdef1', title: 'Title' };
  assert.deepEqual(updateMetadataField(form, 'version', '2.0.0'), { ...form, version: '2.0.0', releaseTag: '', releaseCommit: '' });
  assert.deepEqual(updateMetadataField(form, 'repositoryCode', 'https://github.com/c/d'), { ...form, repositoryCode: 'https://github.com/c/d', releaseTag: '', releaseCommit: '' });
  assert.deepEqual(updateMetadataField(form, 'releaseTag', '1.2.3'), { ...form, releaseTag: '1.2.3', releaseCommit: '' });
  assert.deepEqual(updateMetadataField(form, 'title', 'New title'), { ...form, title: 'New title' });
  assert.strictEqual(updateMetadataField(form, 'version', '1.2.3'), form);
});

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
