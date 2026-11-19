import test from 'node:test';
import assert from 'node:assert/strict';
import { ZENODO_WORKFLOW_CONTENT, ZENODO_WORKFLOW_PATH } from '../../src/services/zenodoWorkflow.js';

test('Zenodo validation workflow is placed in the GitHub workflows folder', () => {
  assert.equal(ZENODO_WORKFLOW_PATH, '.github/workflows/validate-zenodo.yaml');
});

test('Zenodo validation workflow validates .zenodo.json with zenodraft', () => {
  assert.match(ZENODO_WORKFLOW_CONTENT, /zenodraft metadata validate \.zenodo\.json/);
  assert.match(ZENODO_WORKFLOW_CONTENT, /'\.github\/workflows\/validate-zenodo\.yaml'/);
});
