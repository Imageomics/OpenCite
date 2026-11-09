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
