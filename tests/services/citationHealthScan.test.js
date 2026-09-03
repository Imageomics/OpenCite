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
  assert.equal(checks.length >= 11, true);

  for (const check of checks) {
    assert.equal(typeof check.status, 'string');
    assert.equal(typeof check.title, 'string');
    assert.equal(typeof check.description, 'string');
    assert.equal(typeof check.recommendation, 'string');
    assert.equal(['pass', 'warning', 'error'].includes(check.status), true);
  }
});

test('runCitationHealthScan does not include deprecated aggregate release-match check', () => {
  const checks = runCitationHealthScan(baseContext());
  const deprecatedCheck = checks.find((check) => check.title === 'Metadata matches latest GitHub release');

  assert.equal(deprecatedCheck, undefined);
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
  const versionCheck = checks.find((check) => check.title === 'Version is ahead of latest release tag');
  const licenseCheck = checks.find((check) => check.title === 'License matches repository license');
  const authorsCheck = checks.find((check) => check.title === 'Authors are present');
  const doiCheck = checks.find((check) => check.title === 'Project DOI is available');

  assert.equal(citationCheck?.status, 'error');
  assert.equal(versionCheck?.status, 'warning');
  assert.equal(licenseCheck?.status, 'warning');
  assert.equal(authorsCheck?.status, 'error');
  assert.equal(doiCheck?.status, 'pass');
});

test('version check warns when metadata version is not ahead of latest release tag', () => {
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
  const versionCheck = checks.find((check) => check.title === 'Version is ahead of latest release tag');

  assert.equal(versionCheck?.status, 'warning');
});

test('version check passes when metadata version is ahead of latest release from 0.1.0 to 1.0.0', () => {
  const context = baseContext();
  context.releaseData.tag_name = 'v0.1.0';
  context.metadata.version = '1.0.0';

  const checks = runCitationHealthScan(context);
  const versionCheck = checks.find((check) => check.title === 'Version is ahead of latest release tag');

  assert.equal(versionCheck?.status, 'pass');
});

test('version check passes when metadata version is ahead of latest release from 1.0.1 to 1.1.0', () => {
  const context = baseContext();
  context.releaseData.tag_name = 'v1.0.1';
  context.metadata.version = '1.1.0';

  const checks = runCitationHealthScan(context);
  const versionCheck = checks.find((check) => check.title === 'Version is ahead of latest release tag');

  assert.equal(versionCheck?.status, 'pass');
});

test('version check accepts v-prefixed semver with build metadata', () => {
  const context = baseContext();
  context.releaseData.tag_name = 'v1.2.2';
  context.metadata.version = 'v1.2.3+build.5';

  const checks = runCitationHealthScan(context);
  const versionCheck = checks.find((check) => check.title === 'Version is ahead of latest release tag');

  assert.equal(versionCheck?.status, 'pass');
});

test('version check warns when metadata version is invalid semver', () => {
  const context = baseContext();
  context.releaseData.tag_name = 'v1.0.1';
  context.metadata.version = '1.1';

  const checks = runCitationHealthScan(context);
  const versionCheck = checks.find((check) => check.title === 'Version is ahead of latest release tag');

  assert.equal(versionCheck?.status, 'warning');
  assert.match(versionCheck?.description ?? '', /not parseable as semantic versioning/i);
});

test('version check rejects malformed separators in semantic version', () => {
  const context = baseContext();
  context.releaseData.tag_name = 'v1.0.1';
  context.metadata.version = '1x2x3';

  const checks = runCitationHealthScan(context);
  const versionCheck = checks.find((check) => check.title === 'Version is ahead of latest release tag');

  assert.equal(versionCheck?.status, 'warning');
  assert.match(versionCheck?.description ?? '', /not parseable as semantic versioning/i);
});

test('version check warns when metadata version is older than latest release', () => {
  const context = baseContext();
  context.releaseData.tag_name = 'v1.0.1';
  context.metadata.version = '1.0.0';

  const checks = runCitationHealthScan(context);
  const versionCheck = checks.find((check) => check.title === 'Version is ahead of latest release tag');

  assert.equal(versionCheck?.status, 'warning');
});

test('version check passes when no existing release tag is available and metadata version is present', () => {
  const context = baseContext();
  context.releaseData.tag_name = '';

  const checks = runCitationHealthScan(context);
  const versionCheck = checks.find((check) => check.title === 'Version is ahead of latest release tag');

  assert.equal(versionCheck?.status, 'pass');
  assert.match(versionCheck?.description ?? '', /no baseline to compare/i);
});

test('release date check passes when metadata publication date is later than latest release date', () => {
  const context = baseContext();
  context.releaseData.published_at = '2026-01-01T00:00:00Z';
  context.metadata.publicationDate = '2026-02-15';

  const checks = runCitationHealthScan(context);
  const releaseDateCheck = checks.find((check) => check.title === 'Publication date is after latest release date');

  assert.equal(releaseDateCheck?.status, 'pass');
});

test('release date check warns when metadata publication date is the same as latest release date', () => {
  const context = baseContext();
  context.releaseData.published_at = '2026-07-12T00:00:00Z';
  context.metadata.publicationDate = '2026-07-12';

  const checks = runCitationHealthScan(context);
  const releaseDateCheck = checks.find((check) => check.title === 'Publication date is after latest release date');

  assert.equal(releaseDateCheck?.status, 'warning');
});

test('release date check warns when metadata publication date is earlier than latest release date', () => {
  const context = baseContext();
  context.releaseData.published_at = '2026-07-12T00:00:00Z';
  context.metadata.publicationDate = '2026-06-30';

  const checks = runCitationHealthScan(context);
  const releaseDateCheck = checks.find((check) => check.title === 'Publication date is after latest release date');

  assert.equal(releaseDateCheck?.status, 'warning');
});

test('release date check passes when no existing release publish date is available and metadata date is present', () => {
  const context = baseContext();
  context.releaseData.published_at = '';

  const checks = runCitationHealthScan(context);
  const releaseDateCheck = checks.find((check) => check.title === 'Publication date is after latest release date');

  assert.equal(releaseDateCheck?.status, 'pass');
  assert.match(releaseDateCheck?.description ?? '', /no baseline to compare/i);
});

test('release date check warns when metadata publication date is missing', () => {
  const context = baseContext();
  context.metadata.publicationDate = '';

  const checks = runCitationHealthScan(context);
  const releaseDateCheck = checks.find((check) => check.title === 'Publication date is after latest release date');

  assert.equal(releaseDateCheck?.status, 'warning');
  assert.equal(releaseDateCheck?.description, 'Publication date metadata is missing.');
});

test('license and repository checks warn when metadata fields are missing even if repository data exists', () => {
  const context = baseContext();
  context.metadata.license = '';
  context.metadata.repositoryCode = '';

  const checks = runCitationHealthScan(context);
  const licenseCheck = checks.find((check) => check.title === 'License matches repository license');
  const repositoryCheck = checks.find((check) => check.title === 'Repository URL is current');

  assert.equal(licenseCheck?.status, 'warning');
  assert.equal(licenseCheck?.description, 'Repository license is available, but metadata license is missing, so the match cannot be verified.');
  assert.equal(licenseCheck?.recommendation, 'Set metadata license to match repository SPDX license so match verification can be completed.');
  assert.equal(repositoryCheck?.status, 'warning');
});

test('repository URL check passes for equivalent GitHub URL variants', () => {
  const context = baseContext();
  context.repoData.html_url = 'https://github.com/Imageomics/OpenCite';
  context.metadata.repositoryCode = 'git+https://github.com/Imageomics/OpenCite.git/';

  const checks = runCitationHealthScan(context);
  const repositoryCheck = checks.find((check) => check.title === 'Repository URL is current');

  assert.equal(repositoryCheck?.status, 'pass');
  assert.equal(repositoryCheck?.description, 'Repository URL metadata matches the current repository URL.');
});

test('license check warns that match cannot be verified when both repository and metadata license are missing', () => {
  const context = baseContext();
  context.repoData.license = null;
  context.metadata.license = '';

  const checks = runCitationHealthScan(context);
  const licenseCheck = checks.find((check) => check.title === 'License matches repository license');

  assert.equal(licenseCheck?.status, 'warning');
  assert.equal(licenseCheck?.title, 'License matches repository license');
  assert.equal(licenseCheck?.description, 'Neither repository nor metadata license information is available, so the match cannot be verified.');
  assert.equal(licenseCheck?.recommendation, 'Set a clear SPDX license in repository metadata and citation files.');
});

test('license check warns when repository license is missing but metadata license is present', () => {
  const context = baseContext();
  context.repoData.license = null;
  context.metadata.license = 'MIT';

  const checks = runCitationHealthScan(context);
  const licenseCheck = checks.find((check) => check.title === 'License matches repository license');

  assert.equal(licenseCheck?.status, 'warning');
  assert.equal(licenseCheck?.description, 'Metadata license is present, but repository SPDX license is missing, so the match cannot be verified.');
  assert.equal(licenseCheck?.recommendation, 'Add repository SPDX license information and keep metadata aligned with repository policy.');
});

test('license check passes when repository and metadata licenses are both present and matching', () => {
  const context = baseContext();
  context.repoData.license = { spdx_id: 'MIT' };
  context.metadata.license = 'mit';

  const checks = runCitationHealthScan(context);
  const licenseCheck = checks.find((check) => check.title === 'License matches repository license');

  assert.equal(licenseCheck?.status, 'pass');
  assert.equal(licenseCheck?.description, 'Metadata license aligns with repository license information.');
});

test('license check warns when repository and metadata licenses are both present but mismatched', () => {
  const context = baseContext();
  context.repoData.license = { spdx_id: 'MIT' };
  context.metadata.license = 'Apache-2.0';

  const checks = runCitationHealthScan(context);
  const licenseCheck = checks.find((check) => check.title === 'License matches repository license');

  assert.equal(licenseCheck?.status, 'warning');
  assert.equal(licenseCheck?.description, 'Metadata license does not align with repository SPDX license.');
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
  const doiCheck = checks.find((check) => check.title === 'Project DOI is available');

  assert.equal(doiCheck?.status, 'pass');
});

test('DOI check passes when DOI metadata is present', () => {
  const context = baseContext();
  context.metadata.doi = '10.5281/zenodo.1234567';

  const checks = runCitationHealthScan(context);
  const doiCheck = checks.find((check) => check.title === 'Project DOI is available');

  assert.equal(doiCheck?.status, 'pass');
  assert.equal(doiCheck?.description, 'Version-agnostic project DOI is present in citation metadata.');
  assert.equal(doiCheck?.recommendation, 'Keep using the version-agnostic project DOI in citation metadata; version-specific release DOIs are handled separately by the archive/release workflow.');
});

test('DOI check does not warn solely because .zenodo.json is present when DOI is missing', () => {
  const context = baseContext();
  context.metadata.doi = '';
  context.fileValidationSummary.zenodo.present = true;

  const checks = runCitationHealthScan(context);
  const doiCheck = checks.find((check) => check.title === 'Project DOI is available');

  assert.equal(doiCheck?.status, 'pass');
});

test('DOI check does not warn when DOI is missing and no established expectation signal exists', () => {
  const context = baseContext();
  context.metadata.doi = '';

  const checks = runCitationHealthScan(context);
  const doiCheck = checks.find((check) => check.title === 'Project DOI is available');

  assert.equal(doiCheck?.status, 'pass');
  assert.equal(doiCheck?.description, 'A DOI is not required for this citation workflow.');
  assert.equal(doiCheck?.recommendation, 'If a project DOI is available, include the version-agnostic project DOI in citation metadata; do not require a version-specific release DOI in CITATION.cff.');
});

test('citation file check reports missing CITATION.cff with consistent title and description', () => {
  const context = baseContext();
  context.fileValidationSummary.citation.present = false;

  const checks = runCitationHealthScan(context);
  const citationCheck = checks.find((check) => check.description === 'No CITATION.cff file was found in the repository.');

  assert.equal(citationCheck?.status, 'warning');
  assert.equal(citationCheck?.title, 'Repository is missing a CITATION.cff');
});

test('zenodo file check reports missing .zenodo.json with consistent title and description', () => {
  const context = baseContext();
  context.fileValidationSummary.zenodo.present = false;

  const checks = runCitationHealthScan(context);
  const zenodoCheck = checks.find((check) => check.description === 'No .zenodo.json file was found in the repository.');

  assert.equal(zenodoCheck?.status, 'warning');
  assert.equal(zenodoCheck?.title, 'Repository is missing a .zenodo.json');
});
