import test from 'node:test';
import assert from 'node:assert/strict';

import { runCitationHealthScan } from './citationHealthScan.js';

function baseContext() {
  return {
    warnings: [],
    errors: [],
    metadata: {
      version: 'v1.0.0',
      publicationDate: '2026-07-12',
      repositoryCode: 'https://github.com/imageomics/opencite',
      license: 'MIT',
      authors: [
        {
          givenNames: 'Jane',
          familyNames: 'Doe',
          orcid: 'https://orcid.org/0000-0002-1825-0097',
        },
      ],
      keywords: ['citation', 'metadata'],
      abstract: 'A metadata tool.',
      doi: '10.5281/zenodo.1234567',
    },
    repoData: {
      html_url: 'https://github.com/imageomics/opencite',
      license: { spdx_id: 'MIT' },
    },
    releaseData: {
      tag_name: 'v1.0.0',
      published_at: '2026-07-12T00:00:00Z',
    },
    fileValidationSummary: {
      citation: { present: true, valid: true, errors: [] },
      zenodo: { present: true, valid: true, errors: [] },
    },
  };
}

test('runCitationHealthScan returns check objects in expected shape', () => {
  const checks = runCitationHealthScan(baseContext());

  assert.equal(Array.isArray(checks), true);
  assert.equal(checks.length >= 12, true);

  for (const check of checks) {
    assert.equal(typeof check.status, 'string');
    assert.equal(typeof check.title, 'string');
    assert.equal(typeof check.description, 'string');
    assert.equal(typeof check.recommendation, 'string');
    assert.equal(['pass', 'warning', 'error'].includes(check.status), true);
  }
});

test('runCitationHealthScan flags warning/error conditions', () => {
  const context = baseContext();
  context.fileValidationSummary.citation = {
    present: true,
    valid: false,
    errors: ['version is required.'],
  };
  context.metadata.authors = [];
  context.metadata.doi = '';
  context.warnings = [
    {
      code: 'version-mismatch',
      source: 'citation',
      message: 'Version mismatch',
    },
    {
      code: 'license-mismatch',
      source: 'citation',
      message: 'License mismatch',
    },
  ];

  const checks = runCitationHealthScan(context);

  const citationCheck = checks.find((check) => check.title === 'Repository has a CITATION.cff');
  const versionCheck = checks.find((check) => check.title === 'Version matches latest release tag');
  const licenseCheck = checks.find((check) => check.title === 'License matches repository license');
  const authorsCheck = checks.find((check) => check.title === 'Authors are present');
  const doiCheck = checks.find((check) => check.title === 'DOI exists (when expected)');

  assert.equal(citationCheck?.status, 'error');
  assert.equal(versionCheck?.status, 'warning');
  assert.equal(licenseCheck?.status, 'warning');
  assert.equal(authorsCheck?.status, 'error');
  assert.equal(doiCheck?.status, 'warning');
});
