import { isValidOrcidFormat } from '../utils/orcid.js';

function cleanString(value) {
  return String(value ?? '').trim();
}

function hasWarningCode(warnings, codes) {
  const codeSet = new Set(codes);
  return Array.isArray(warnings) && warnings.some((warning) => codeSet.has(String(warning?.code ?? '')));
}

function hasReleaseData(releaseData) {
  return Boolean(cleanString(releaseData?.tag_name) || cleanString(releaseData?.published_at));
}

function normalizeDate(value) {
  return cleanString(value).split('T')[0];
}

function buildCheck(status, title, description, recommendation) {
  return {
    status,
    title,
    description,
    recommendation,
  };
}

function checkCitationFile(context) {
  const citation = context.fileValidationSummary?.citation;

  if (citation?.present) {
    if (citation.valid) {
      return buildCheck(
        'pass',
        'Repository has a CITATION.cff',
        'CITATION.cff was found and passed schema validation.',
        'Keep the file and update only changed fields when needed.',
      );
    }

    return buildCheck(
      'error',
      'Repository has a CITATION.cff',
      `CITATION.cff exists but is invalid: ${(citation.errors || []).join(' | ')}`,
      'Fix required fields or regenerate CITATION.cff before trusting imported values.',
    );
  }

  return buildCheck(
    'warning',
    'Repository has a CITATION.cff',
    'No CITATION.cff file was found in the repository.',
    'Generate a CITATION.cff file to improve citation metadata quality.',
  );
}

function checkZenodoFile(context) {
  const zenodo = context.fileValidationSummary?.zenodo;

  if (zenodo?.present) {
    if (zenodo.valid) {
      return buildCheck(
        'pass',
        'Repository has a .zenodo.json',
        '.zenodo.json was found and passed schema validation.',
        'Keep the file and update only changed fields when needed.',
      );
    }

    return buildCheck(
      'error',
      'Repository has a .zenodo.json',
      `.zenodo.json exists but is invalid: ${(zenodo.errors || []).join(' | ')}`,
      'Fix required fields or regenerate .zenodo.json before trusting imported values.',
    );
  }

  return buildCheck(
    'warning',
    'Repository has a .zenodo.json',
    'No .zenodo.json file was found in the repository.',
    'Generate a .zenodo.json file for Zenodo-compatible metadata exports.',
  );
}

function checkMetadataMatchesRelease(context) {
  const { releaseData, warnings } = context;

  if (!hasReleaseData(releaseData)) {
    return buildCheck(
      'warning',
      'Metadata matches latest GitHub release',
      'No latest release metadata is available, so full release consistency cannot be verified.',
      'Create a GitHub release to enable complete release-based consistency checks.',
    );
  }

  if (hasWarningCode(warnings, ['version-mismatch', 'cross-file-version-mismatch', 'date-mismatch', 'missing-version'])) {
    return buildCheck(
      'warning',
      'Metadata matches latest GitHub release',
      'One or more metadata fields are inconsistent with the latest GitHub release data.',
      'Update version/date fields to align with the latest release tag and publish date.',
    );
  }

  return buildCheck(
    'pass',
    'Metadata matches latest GitHub release',
    'Release-sensitive metadata is aligned with the latest GitHub release.',
    'Keep these release-linked fields synchronized for future releases.',
  );
}

function checkRepositoryUrlCurrent(context) {
  const repoUrl = cleanString(context.repoData?.html_url);
  const metadataRepoUrl = cleanString(context.metadata?.repositoryCode);

  if (!repoUrl && !metadataRepoUrl) {
    return buildCheck(
      'warning',
      'Repository URL is current',
      'Repository URL metadata is not available for comparison.',
      'Set repository-code to the canonical GitHub repository URL.',
    );
  }

  if (hasWarningCode(context.warnings, ['repository-url-mismatch'])) {
    return buildCheck(
      'warning',
      'Repository URL is current',
      'Imported repository URL does not match the current repository URL.',
      'Update repository-code to match the current GitHub repository URL.',
    );
  }

  return buildCheck(
    'pass',
    'Repository URL is current',
    'Repository URL metadata matches the current repository URL.',
    'Keep repository URL updated after transfers or renames.',
  );
}

function checkVersionMatchesRelease(context) {
  const releaseTag = cleanString(context.releaseData?.tag_name);
  const version = cleanString(context.metadata?.version);

  if (!releaseTag) {
    return buildCheck(
      'warning',
      'Version matches latest release tag',
      'No latest release tag is available for version comparison.',
      'Create a GitHub release tag to enforce version consistency checks.',
    );
  }

  if (!version) {
    return buildCheck(
      'error',
      'Version matches latest release tag',
      'Version metadata is missing.',
      'Set version to match the latest release tag.',
    );
  }

  if (hasWarningCode(context.warnings, ['version-mismatch', 'cross-file-version-mismatch'])) {
    return buildCheck(
      'warning',
      'Version matches latest release tag',
      `Version metadata does not align with the latest release tag (${releaseTag}).`,
      'Update version values in metadata files to match the latest release tag.',
    );
  }

  return buildCheck(
    'pass',
    'Version matches latest release tag',
    `Version metadata aligns with latest release tag (${releaseTag}).`,
    'Keep version updates coupled with each release tag.',
  );
}

function checkReleaseDateMatchesRelease(context) {
  const releaseDate = normalizeDate(context.releaseData?.published_at);
  const metadataDate = normalizeDate(context.metadata?.publicationDate);

  if (!releaseDate) {
    return buildCheck(
      'warning',
      'Release date matches latest GitHub release',
      'No latest release publish date is available for comparison.',
      'Publish a release to validate release-date consistency.',
    );
  }

  if (!metadataDate) {
    return buildCheck(
      'error',
      'Release date matches latest GitHub release',
      'Publication date metadata is missing.',
      'Set publication date to the latest release publish date.',
    );
  }

  if (hasWarningCode(context.warnings, ['date-mismatch'])) {
    return buildCheck(
      'warning',
      'Release date matches latest GitHub release',
      `Metadata publication date does not align with latest release date (${releaseDate}).`,
      'Update metadata publication date to the latest release publish date.',
    );
  }

  return buildCheck(
    'pass',
    'Release date matches latest GitHub release',
    `Publication date metadata aligns with latest release date (${releaseDate}).`,
    'Keep publication date synchronized with release publish date.',
  );
}

function checkLicenseMatchesRepository(context) {
  const repositoryLicense = cleanString(context.repoData?.license?.spdx_id);
  const metadataLicense = cleanString(context.metadata?.license);

  if (!repositoryLicense && !metadataLicense) {
    return buildCheck(
      'warning',
      'License matches repository license',
      'No repository or metadata license information is available.',
      'Set a clear SPDX license in repository metadata and citation files.',
    );
  }

  if (hasWarningCode(context.warnings, ['license-mismatch'])) {
    return buildCheck(
      'warning',
      'License matches repository license',
      'Metadata license does not align with repository SPDX license.',
      'Update citation metadata license to match repository license policy.',
    );
  }

  return buildCheck(
    'pass',
    'License matches repository license',
    'Metadata license aligns with repository license information.',
    'Keep license metadata aligned with repository SPDX settings.',
  );
}

function checkAuthorsPresent(context) {
  const authors = Array.isArray(context.metadata?.authors) ? context.metadata.authors : [];

  if (authors.length === 0) {
    return buildCheck(
      'error',
      'Authors are present',
      'No authors were found in merged metadata.',
      'Add at least one author to citation metadata before export.',
    );
  }

  return buildCheck(
    'pass',
    'Authors are present',
    `${authors.length} author${authors.length === 1 ? '' : 's'} found in metadata.`,
    'Maintain complete author attribution for each release.',
  );
}

function checkOrcidValid(context) {
  const authors = Array.isArray(context.metadata?.authors) ? context.metadata.authors : [];
  const authoredOrcids = authors.map((author) => cleanString(author?.orcid)).filter(Boolean);
  const missingCount = authors.filter((author) => !cleanString(author?.orcid)).length;

  if (authoredOrcids.length === 0) {
    return buildCheck(
      'warning',
      'ORCID IDs are valid',
      missingCount > 0
        ? `Missing ORCID for ${missingCount} author${missingCount === 1 ? '' : 's'}.`
        : 'No ORCID IDs were provided for authors.',
      'Add ORCID IDs for contributors when available to improve author disambiguation.',
    );
  }

  if (missingCount > 0) {
    return buildCheck(
      'warning',
      'ORCID IDs are valid',
      `Missing ORCID for ${missingCount} author${missingCount === 1 ? '' : 's'}.`,
      'Add ORCID IDs for contributors when available to improve author disambiguation.',
    );
  }

  const invalidOrcids = authoredOrcids.filter((orcid) => !isValidOrcidFormat(orcid));

  if (invalidOrcids.length > 0) {
    return buildCheck(
      'error',
      'ORCID IDs are valid',
      `${invalidOrcids.length} ORCID value${invalidOrcids.length === 1 ? ' is' : 's are'} invalid.`,
      'Correct ORCID format/checksum for all listed author ORCID identifiers.',
    );
  }

  return buildCheck(
    'pass',
    'ORCID IDs are valid',
    'All provided ORCID IDs are valid.',
    'Keep ORCID IDs updated for ongoing contributor attribution.',
  );
}

function checkKeywordsExist(context) {
  const keywords = Array.isArray(context.metadata?.keywords) ? context.metadata.keywords.filter(Boolean) : [];

  if (keywords.length === 0) {
    return buildCheck(
      'warning',
      'Keywords exist',
      'No keywords were found in metadata.',
      'Add project keywords to improve discoverability in citation systems.',
    );
  }

  return buildCheck(
    'pass',
    'Keywords exist',
    `${keywords.length} keyword${keywords.length === 1 ? '' : 's'} found in metadata.`,
    'Keep keywords focused and current with project scope.',
  );
}

function checkAbstractExists(context) {
  const abstract = cleanString(context.metadata?.abstract);

  if (!abstract) {
    return buildCheck(
      'warning',
      'Abstract exists',
      'No abstract/description was found in metadata.',
      'Add a concise abstract describing purpose and scope of the project.',
    );
  }

  return buildCheck(
    'pass',
    'Abstract exists',
    'Abstract/description is present in metadata.',
    'Keep abstract up to date as project goals evolve.',
  );
}

function shouldExpectDoi(context) {
  const zenodoPresent = Boolean(context.fileValidationSummary?.zenodo?.present);
  const hasRelease = hasReleaseData(context.releaseData);
  return zenodoPresent || hasRelease;
}

function checkDoiExistsWhenExpected(context) {
  const doi = cleanString(context.metadata?.doi);
  const expected = shouldExpectDoi(context);

  if (doi) {
    return buildCheck(
      'pass',
      'DOI exists (when expected)',
      'DOI metadata is present.',
      'Keep DOI updated when minting new archived releases.',
    );
  }

  if (!expected) {
    return buildCheck(
      'pass',
      'DOI exists (when expected)',
      'DOI is not currently expected because release/archive signals are not present.',
      'Add DOI when a citable archived release is minted.',
    );
  }

  return buildCheck(
    'warning',
    'DOI exists (when expected)',
    'DOI is missing even though release/archive indicators suggest one may be expected.',
    'Mint or add the DOI from your archival release (for example Zenodo) if available.',
  );
}

export const defaultCitationHealthChecks = [
  checkCitationFile,
  checkZenodoFile,
  checkMetadataMatchesRelease,
  checkRepositoryUrlCurrent,
  checkVersionMatchesRelease,
  checkReleaseDateMatchesRelease,
  checkLicenseMatchesRepository,
  checkAuthorsPresent,
  checkOrcidValid,
  checkKeywordsExist,
  checkAbstractExists,
  checkDoiExistsWhenExpected,
];

export function runCitationHealthScan(context, checks = defaultCitationHealthChecks) {
  return checks.map((check) => check(context));
}
