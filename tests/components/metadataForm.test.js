import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('ORCID suggestions show names and affiliations, and lookup can be disabled', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { MetadataForm } = await server.ssrLoadModule('/src/components/MetadataForm.jsx');
    const form = {
      authors: [{ givenNames: 'Jane', familyNames: 'Doe', orcid: '', affiliation: '' }],
    };
    const candidate = {
      label: 'Jane Doe',
      orcid: 'https://orcid.org/0000-0000-0000-0001',
      affiliations: ['First University', 'Second Institute'],
    };
    const props = {
      form,
      typeOptions: [],
      licenseOptions: [],
      orcidSuggestions: { 0: { suggestions: [candidate] } },
      orcidLookupEnabled: true,
      changeOrcidLookup: () => {},
    };
    const enabled = renderToStaticMarkup(React.createElement(MetadataForm, props));
    assert.match(enabled, /Jane Doe/);
    assert.match(enabled, /First University; Second Institute/);
    assert.match(enabled, /ORCID: 0000-0000-0000-0001/);
    assert.match(enabled, /type="checkbox" checked=""/);

    const disabled = renderToStaticMarkup(React.createElement(MetadataForm, {
      ...props,
      orcidLookupEnabled: false,
      orcidSuggestions: {},
    }));
    assert.match(disabled, /disabled="">Suggest ORCID/);
  } finally {
    await server.close();
  }
});

const noop = () => {};

test('release tag mismatch is explained without changing the citation version', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { MetadataForm } = await server.ssrLoadModule('/src/components/MetadataForm.jsx');
    const form = {
      title: 'OpenCite',
      abstract: '',
      authors: [],
      typeOfWork: 'software',
      customTypeOfWork: '',
      version: '2.0.0',
      publicationDate: '',
      license: 'MIT',
      repositoryCode: 'https://github.com/Imageomics/OpenCite',
      releaseTag: 'v1.1.0',
      releaseCommit: '',
      doi: '',
      keywords: '',
      references: '',
      grants: '',
    };
    const props = {
      form,
      typeOptions: [{ value: 'software', label: 'Software' }],
      licenseOptions: ['MIT'],
      updateField: noop,
      updateAuthorField: noop,
      appendGrantSuggestion: noop,
      appendAllGrantSuggestions: noop,
      suggestOrcid: noop,
      applySuggestedOrcid: noop,
      reorderAuthor: noop,
      addAuthor: noop,
      removeAuthor: noop,
    };

    const mismatch = renderToStaticMarkup(React.createElement(MetadataForm, props));
    assert.match(mismatch, /role="status"/);
    assert.match(mismatch, /The GitHub tag &quot;v1\.1\.0&quot; does not match the cited version &quot;2\.0\.0&quot;/);
    assert.match(mismatch, /Version to cite\*/);
    assert.match(mismatch, /GitHub release tag/);

    const matching = renderToStaticMarkup(React.createElement(MetadataForm, {
      ...props,
      form: { ...form, releaseTag: 'v2.0.0' },
    }));
    assert.doesNotMatch(matching, /release-tag-warning/);
  } finally {
    await server.close();
  }
});
