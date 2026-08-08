import test from 'node:test';
import assert from 'node:assert/strict';

import { runCitationHealthScan } from '../../src/services/citationHealthScan.js';

function baseContext() {
  return {
    warnings: [],
    errors: [],
    metadata: {
      version: '1.0.0',
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
  context.metadata.version = '0.9.0';
  context.metadata.license = 'Apache-2.0';
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

test('version check ignores cross-file mismatch when metadata version matches release tag', () => {
  const context = baseContext();
  context.metadata.version = '1.0.0';
  context.releaseData.tag_name = 'v1.0.0';
  context.warnings = [
    {
      code: 'cross-file-version-mismatch',
      source: 'citation',
      message: 'CITATION.cff and .zenodo.json versions differ.',
    },
  ];

  const checks = runCitationHealthScan(context);
  const versionCheck = checks.find((check) => check.title === 'Version matches latest release tag');

  assert.equal(versionCheck?.status, 'pass');
});

test('license and repository checks warn when metadata fields are missing even if repository data exists', () => {
  const context = baseContext();
  context.metadata.license = '';
  context.metadata.repositoryCode = '';

  const checks = runCitationHealthScan(context);
  const licenseCheck = checks.find((check) => check.title === 'License matches repository license');
  const repositoryCheck = checks.find((check) => check.title === 'Repository URL is current');

  assert.equal(licenseCheck?.status, 'warning');
  assert.equal(repositoryCheck?.status, 'warning');
});

test('ORCID check reports invalid ORCID as error even when other authors are missing ORCID', () => {
  const context = baseContext();
  context.metadata.authors = [
    {
      givenNames: 'Jane',
      familyNames: 'Doe',
      orcid: '0000-0000-0000-0000',
    },
    {
      givenNames: 'John',
      familyNames: 'Smith',
      orcid: '',
    },
  ];

  const checks = runCitationHealthScan(context);
  const orcidCheck = checks.find((check) => check.title === 'ORCID IDs are valid');

  assert.equal(orcidCheck?.status, 'error');
  assert.match(orcidCheck?.description ?? '', /invalid/i);
});

test('DOI check does not warn solely because a release exists when zenodo metadata is absent', () => {
  const context = baseContext();
  context.metadata.doi = '';
  context.fileValidationSummary.zenodo.present = false;
  context.releaseData = {
    tag_name: 'v1.0.0',
    published_at: '2026-07-12T00:00:00Z',
  };

  const checks = runCitationHealthScan(context);
  const doiCheck = checks.find((check) => check.title === 'DOI exists (when expected)');

  assert.equal(doiCheck?.status, 'pass');
});
