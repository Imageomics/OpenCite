import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createServer } from 'vite';

test('metadata ZIP preserves the exact dotfile name and both export contents', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { createMetadataZipBlob } = await vite.ssrLoadModule('/src/App.jsx');
    const citation = 'cff-version: 1.2.0\n';
    const zenodo = '{"title":"OpenCite"}';
    const report = 'Validation passed';
    const blob = await createMetadataZipBlob(citation, zenodo, report);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    assert.deepEqual(Object.keys(zip.files).sort(), ['.zenodo.json', 'CITATION.cff', 'METADATA_VALIDATION.txt']);
    assert.equal(await zip.file('.zenodo.json').async('string'), zenodo);
    assert.equal(await zip.file('CITATION.cff').async('string'), citation);
    assert.equal(await zip.file('METADATA_VALIDATION.txt').async('string'), report);
  } finally {
    await vite.close();
  }
});