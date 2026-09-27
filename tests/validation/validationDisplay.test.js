import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('required fields stay neutral until touched or export validation is requested', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { MetadataForm } = await vite.ssrLoadModule('/src/components/MetadataForm.jsx');
    const form = {
      title: '', authors: [], typeOfWork: 'software', version: '0.1.0',
      publicationDate: '', license: '', grants: '', abstract: '', keywords: '',
      repositoryCode: '', doi: '', references: '',
    };
    const errors = { title: 'Title is required', authors: 'Author is required' };
    const props = {
      form, errors, typeOptions: [], licenseOptions: [], orcidSuggestions: {}, grantSuggestions: [],
      updateField: () => {}, updateAuthorField: () => {},
    };

    const initial = renderToStaticMarkup(createElement(MetadataForm, props));
    assert.match(initial, /Title\*/);
    assert.match(initial, /Authors\*/);
    assert.doesNotMatch(initial, /Title is required|Author is required|input-error/);
    assert.match(initial, /name="title"[^>]*aria-invalid="false"/);

    const touched = renderToStaticMarkup(createElement(MetadataForm, { ...props, touchedFields: { title: true } }));
    assert.match(touched, /Title is required/);
    assert.doesNotMatch(touched, /Author is required/);

    const attemptedExport = renderToStaticMarkup(createElement(MetadataForm, { ...props, showValidationErrors: true }));
    assert.match(attemptedExport, /Title is required/);
    assert.match(attemptedExport, /Author is required/);
    assert.match(attemptedExport, /name="title"[^>]*aria-invalid="true"/);
  } finally {
    await vite.close();
  }
});