import { isValidOrcidFormat } from '../utils/orcid.js';

function cleanString(value) {
  return String(value ?? '').trim();
}

function normalizeDate(value) {
  return cleanString(value).split('T')[0];
}

function normalizeVersion(value) {
  return cleanString(value).toLowerCase().replace(/^v(?=\d)/, '');
}

function parseSemver(value) {
  const normalized = normalizeVersion(value);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z]+(?:\.[0-9a-z]+)*))?(?:\+[0-9a-z]+(?:\.[0-9a-z]+)*)?$/i);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
  };
}

function comparePrerelease(left, right) {
  const leftParts = left ? left.split('.') : [];
  const rightParts = right ? right.split('.') : [];

  if (leftParts.length === 0 && rightParts.length === 0) {
    return 0;
  }

  if (leftParts.length === 0) {
    return 1;
  }

  if (rightParts.length === 0) {
    return -1;
  }

  const limit = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < limit; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart == null) {
      return -1;
    }

    if (rightPart == null) {
      return 1;
    }

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);

    if (leftNumeric && rightNumeric) {
      const diff = Number(leftPart) - Number(rightPart);
      if (diff !== 0) {
        return diff;
      }
      continue;
    }

    if (leftNumeric && !rightNumeric) {
      return -1;
    }

    if (!leftNumeric && rightNumeric) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }

    if (leftPart > rightPart) {
      return 1;
    }
  }

  return 0;
}

function compareSemver(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function normalizeRepoUrl(value) {
  return cleanString(value)
    .replace(/^git\+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function normalizeLicense(value) {
  return cleanString(value)
    .toUpperCase()
    .replace(/^SPDX:/, '')
    .trim();
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
    'Repository is missing a CITATION.cff',
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
    'Repository is missing a .zenodo.json',
    'No .zenodo.json file was found in the repository.',
    'Generate a .zenodo.json file for Zenodo-compatible metadata exports.',
  );
}

function checkRepositoryUrlCurrent(context) {
  const repoUrl = normalizeRepoUrl(context.repoData?.html_url);
  const metadataRepoUrl = normalizeRepoUrl(context.metadata?.repositoryCode);

  if (!repoUrl && !metadataRepoUrl) {
    return buildCheck(
      'warning',
      'Repository URL is current',
      'Repository URL metadata is not available for comparison.',
      'Set repository-code to the canonical GitHub repository URL.',
    );
  }

  if (repoUrl && !metadataRepoUrl) {
    return buildCheck(
      'warning',
      'Repository URL is current',
      'Repository URL is available, but repository-code is missing from imported metadata.',
      'Set repository-code to the canonical GitHub repository URL.',
    );
  }

  if (!repoUrl && metadataRepoUrl) {
    return buildCheck(
      'warning',
      'Repository URL is current',
      'Repository URL could not be verified from GitHub API data.',
      'Verify repository-code manually and rerun import when GitHub API access is available.',
    );
  }

  if (repoUrl && metadataRepoUrl && repoUrl !== metadataRepoUrl) {
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
  const releaseSemver = parseSemver(releaseTag);
  const metadataSemver = parseSemver(version);

  if (!version) {
    return buildCheck(
      'error',
      'Version is ahead of latest release tag',
      'Version metadata is missing.',
      'Set a semantic version for the upcoming release metadata.',
    );
  }

  if (!metadataSemver) {
    return buildCheck(
      'warning',
      'Version is ahead of latest release tag',
      `Version metadata (${version}) is not parseable as semantic versioning.`,
      'Use semantic version format (for example 1.2.3) for upcoming-release metadata.',
    );
  }

  if (!releaseTag) {
    return buildCheck(
      'pass',
      'Version is ahead of latest release tag',
      'No latest release tag is available, so there is no baseline to compare; metadata version is accepted for the planned upcoming release.',
      'Keep semantic versioning for planned releases; progression checks will apply once a baseline release exists.',
    );
  }

  if (!releaseSemver) {
    return buildCheck(
      'warning',
      'Version is ahead of latest release tag',
      `Latest release tag (${releaseTag}) is not parseable as semantic versioning.`,
      'Use semantic version release tags (for example v1.2.3) so upcoming-release progression can be validated.',
    );
  }

  if (compareSemver(metadataSemver, releaseSemver) <= 0) {
    return buildCheck(
      'warning',
      'Version is ahead of latest release tag',
      `Version metadata (${version}) is not ahead of the latest release tag (${releaseTag}).`,
      'Set metadata version to the next logical semantic version for the upcoming release.',
    );
  }

  return buildCheck(
    'pass',
    'Version is ahead of latest release tag',
    `Version metadata (${version}) is a valid next semantic version relative to latest release (${releaseTag}).`,
    'Keep metadata version ahead of the latest release while preparing the next release.',
  );
}

function checkReleaseDateMatchesRelease(context) {
  const releaseDate = normalizeDate(context.releaseData?.published_at);
  const metadataDate = normalizeDate(context.metadata?.publicationDate);

  if (!metadataDate) {
    return buildCheck(
      'warning',
      'Publication date is after latest release date',
      'Publication date metadata is missing.',
      'Set publication date for the planned upcoming release.',
    );
  }

  if (!releaseDate) {
    return buildCheck(
      'pass',
      'Publication date is after latest release date',
      'No latest release publish date is available, so there is no baseline to compare; metadata publication date is accepted for the planned upcoming release.',
      'Keep publication date current for the planned release; progression checks will apply once a baseline release exists.',
    );
  }

  if (releaseDate && metadataDate && metadataDate <= releaseDate) {
    return buildCheck(
      'warning',
      'Publication date is after latest release date',
      `Metadata publication date (${metadataDate}) is not later than latest release date (${releaseDate}).`,
      'Set publication date for a newer upcoming release timeline.',
    );
  }

  return buildCheck(
    'pass',
    'Publication date is after latest release date',
    `Publication date metadata (${metadataDate}) is later than latest release date (${releaseDate}).`,
    'Keep publication date current for the next planned release.',
  );
}

function checkLicenseMatchesRepository(context) {
  const repositoryLicense = normalizeLicense(context.repoData?.license?.spdx_id);
  const metadataLicense = normalizeLicense(context.metadata?.license);

  if (!repositoryLicense && !metadataLicense) {
    return buildCheck(
      'warning',
      'License matches repository license',
      'Neither repository nor metadata license information is available, so the match cannot be verified.',
      'Set a clear SPDX license in repository metadata and citation files.',
    );
  }

  if (repositoryLicense && !metadataLicense) {
    return buildCheck(
      'warning',
      'License matches repository license',
      'Repository license is available, but metadata license is missing, so the match cannot be verified.',
      'Set metadata license to match repository SPDX license so match verification can be completed.',
    );
  }

  if (!repositoryLicense && metadataLicense) {
    return buildCheck(
      'warning',
      'License matches repository license',
      'Metadata license is present, but repository SPDX license is missing, so the match cannot be verified.',
      'Add repository SPDX license information and keep metadata aligned with repository policy.',
    );
  }

  if (repositoryLicense && metadataLicense && repositoryLicense !== metadataLicense) {
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

  const invalidOrcids = authoredOrcids.filter((orcid) => !isValidOrcidFormat(orcid));

  if (invalidOrcids.length > 0) {
    return buildCheck(
      'error',
      'ORCID IDs are valid',
      `${invalidOrcids.length} ORCID value${invalidOrcids.length === 1 ? ' is' : 's are'} invalid.`
      + (missingCount > 0 ? ` Missing ORCID for ${missingCount} author${missingCount === 1 ? '' : 's'}.` : ''),
      'Correct ORCID format/checksum for all listed ORCID identifiers and add missing ORCIDs when available.',
    );
  }

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
  return zenodoPresent;
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
