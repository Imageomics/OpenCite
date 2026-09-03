import { normalizeDateForComparison } from './githubImporterUtils.js';

/**
 * @typedef {'identical' | 'different' | 'missing' | 'cannot determine'} ValidationStatus
 */

/**
 * @typedef {Object} ValidationResult
 * @property {string} file
 * @property {string} field
 * @property {ValidationStatus} status
 * @property {string} currentValue
 * @property {string} githubValue
 * @property {string} recommendation
 */

function cleanString(value) {
  return String(value ?? '').trim();
}

function normalizeUrl(value) {
  const text = cleanString(value);
  if (!text) {
    return '';
  }

  return text.replace(/^git\+/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

function normalizeDate(value) {
  return normalizeDateForComparison(value);
}

function normalizeVersion(value) {
  return cleanString(value).toLowerCase().replace(/^v(?=\d)/, '');
}

function authorDisplayName(author) {
  const given = cleanString(author?.givenNames ?? author?.['given-names'] ?? '');
  const family = cleanString(author?.familyNames ?? author?.['family-names'] ?? '');
  const name = cleanString(author?.name ?? '');

  if (name) {
    return name;
  }

  return [given, family].filter(Boolean).join(' ').trim();
}

function authorSortKey(author) {
  const given = cleanString(author?.givenNames ?? author?.['given-names'] ?? '').toLowerCase();
  const family = cleanString(author?.familyNames ?? author?.['family-names'] ?? '').toLowerCase();
  const name = cleanString(author?.name ?? '').toLowerCase();

  if (family || given) {
    return `${family}\u0000${given}`;
  }

  const commaIndex = name.indexOf(',');
  if (commaIndex >= 0) {
    return `${name.slice(0, commaIndex).trim()}\u0000${name.slice(commaIndex + 1).trim()}`;
  }

  return `\u0000${name}`;
}

function normalizeAuthorList(authors) {
  if (!Array.isArray(authors)) {
    return [];
  }

  return authors
    .map((author) => ({
      displayName: authorDisplayName(author).toLowerCase(),
      sortKey: authorSortKey(author),
    }))
    .filter((author) => author.displayName)
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map((author) => author.displayName);
}

function normalizeKeywordList(keywords) {
  if (!Array.isArray(keywords)) {
    return [];
  }

  return keywords.map((item) => cleanString(item).toLowerCase()).filter(Boolean).sort();
}

function determineStatus({ currentValue, githubValue, canDetermine }) {
  if (!canDetermine) {
    return 'cannot determine';
  }

  if (!cleanString(currentValue)) {
    return 'missing';
  }

  if (currentValue === githubValue) {
    return 'identical';
  }

  return 'different';
}

function createValidationResult({
  file,
  field,
  currentValue,
  githubValue,
  canDetermine = true,
  recommendations = {},
}) {
  const status = determineStatus({ currentValue, githubValue, canDetermine });

  const recommendation =
    recommendations[status]
    ?? (status === 'identical'
      ? 'No update needed.'
      : status === 'cannot determine'
        ? 'Cannot determine from live GitHub metadata; review manually.'
        : status === 'missing'
          ? `Add ${field} from current metadata sources.`
          : `Review and update ${field} to match current repository metadata.`);

  return {
    file,
    field,
    status,
    currentValue,
    githubValue,
    recommendation,
  };
}

export function validateVersion({ file, metadata, context }) {
  const currentValue = normalizeVersion(metadata?.version);
  const githubValue = normalizeVersion(context.releaseData?.tag_name);

  return createValidationResult({
    file,
    field: 'version',
    currentValue,
    githubValue,
    canDetermine: Boolean(githubValue),
    recommendations: {
      different: 'Update version to latest release.',
      missing: 'Add version from latest release tag.',
    },
  });
}

export function validateRepositoryUrl({ file, metadata, context }) {
  const currentValue = normalizeUrl(metadata?.repositoryCode);
  const githubValue = normalizeUrl(context.repoData?.html_url);

  return createValidationResult({
    file,
    field: 'repository-code',
    currentValue,
    githubValue,
    canDetermine: Boolean(githubValue),
    recommendations: {
      different: 'Repository was renamed. Update repository-code.',
      missing: 'Add repository-code from current GitHub URL.',
    },
  });
}

export function validateLicense({ file, metadata, context }) {
  const currentValue = cleanString(metadata?.license).toUpperCase();
  const githubValue = cleanString(context.repoData?.license?.spdx_id).toUpperCase();

  return createValidationResult({
    file,
    field: 'license',
    currentValue,
    githubValue,
    canDetermine: Boolean(githubValue),
    recommendations: {
      different: 'Review repository license and align citation metadata if needed.',
      missing: 'Add repository SPDX license to metadata.',
    },
  });
}

export function validateReleaseDate({ file, metadata, context }) {
  const field = file === '.zenodo.json' ? 'publication_date' : 'date-released';
  const currentValue = normalizeDate(metadata?.publicationDate);
  const githubValue = normalizeDate(context.releaseData?.published_at);

  return createValidationResult({
    file,
    field,
    currentValue,
    githubValue,
    canDetermine: Boolean(githubValue),
    recommendations: {
      different: 'Update release date to match latest GitHub release date.',
      missing: 'Add latest release date to metadata.',
    },
  });
}

export function validateAuthors({ file, metadata, context }) {
  const currentValue = normalizeAuthorList(metadata?.authors).join(', ');
  const githubValue = normalizeAuthorList(context.contributorLookupAuthors).join(', ');

  return createValidationResult({
    file,
    field: 'authors',
    currentValue,
    githubValue,
    canDetermine: Boolean(githubValue),
    recommendations: {
      different: 'Review author list and update contributor attribution as needed.',
      missing: 'Add authors from repository contributors or known citation authors.',
    },
  });
}

export function validateORCID({ file, metadata }) {
  const authors = Array.isArray(metadata?.authors) ? metadata.authors : [];
  const currentWithOrcid = authors.filter((author) => cleanString(author?.orcid)).length;
  const currentValue = String(currentWithOrcid);
  const githubValue = '';

  return createValidationResult({
    file,
    field: 'orcid',
    currentValue,
    githubValue,
    canDetermine: false,
    recommendations: {
      'cannot determine': 'ORCID cannot be determined from GitHub metadata alone; review manually.',
      missing: 'Add ORCID IDs for authors when available.',
    },
  });
}

export function validateDOI({ file, metadata }) {
  const currentValue = cleanString(metadata?.doi);
  const githubValue = '';

  return createValidationResult({
    file,
    field: 'doi',
    currentValue,
    githubValue,
    canDetermine: false,
    recommendations: {
      'cannot determine': 'DOI cannot be determined from GitHub metadata alone; review manually.',
      missing: 'Add DOI if you have an archival DOI (for example from Zenodo).',
    },
  });
}

export function validateKeywords({ file, metadata, context }) {
  const currentValue = normalizeKeywordList(metadata?.keywords).join(', ');
  const githubValue = normalizeKeywordList(context.repoData?.topics).join(', ');

  return createValidationResult({
    file,
    field: 'keywords',
    currentValue,
    githubValue,
    canDetermine: Boolean(githubValue),
    recommendations: {
      different: 'Review keywords and align with repository topics where appropriate.',
      missing: 'Add keywords to improve discoverability.',
    },
  });
}

export function validateAbstract({ file, metadata, context }) {
  const currentValue = cleanString(metadata?.abstract);
  const githubValue = cleanString(context.repoData?.description);

  return createValidationResult({
    file,
    field: 'abstract',
    currentValue,
    githubValue,
    canDetermine: Boolean(githubValue),
    recommendations: {
      different: 'Review abstract text against repository description and update if outdated.',
      missing: 'Add an abstract/description for citation clarity.',
    },
  });
}

export const DEFAULT_METADATA_VALIDATORS = [
  validateVersion,
  validateRepositoryUrl,
  validateLicense,
  validateReleaseDate,
  validateAuthors,
  validateORCID,
  validateDOI,
  validateKeywords,
  validateAbstract,
];

export function runMetadataValidators({ file, metadata, context, validators = DEFAULT_METADATA_VALIDATORS }) {
  return validators.map((validator) => validator({ file, metadata, context }));
}
