import test from 'node:test';
import assert from 'node:assert/strict';

import { lookupZenodoDoi } from '../../src/services/doiLookup.js';

test('lookupZenodoDoi returns a DOI for an exact repository-linked Zenodo record', async () => {
  const doi = await lookupZenodoDoi({
    repositoryUrl: 'https://github.com/Imageomics/catalog',
    title: 'Imageomics Catalog',
    fetchImpl: async () => Response.json({
      hits: {
        hits: [{
          metadata: {
            title: 'Imageomics Catalog',
            doi: '10.5281/zenodo.17602801',
            related_identifiers: [{ identifier: 'https://github.com/Imageomics/catalog' }],
          },
        }],
      },
    }),
  });

  assert.equal(doi, '10.5281/zenodo.17602801');
});

test('lookupZenodoDoi rejects an unrelated ambiguous title match', async () => {
  const doi = await lookupZenodoDoi({
    repositoryUrl: 'https://github.com/Imageomics/catalog',
    title: 'Catalog',
    fetchImpl: async () => Response.json({
      hits: {
        hits: [
          { metadata: { title: 'Catalog', doi: '10.5281/zenodo.1' } },
          { metadata: { title: 'Catalog', doi: '10.5281/zenodo.2' } },
        ],
      },
    }),
  });

  assert.equal(doi, null);
});