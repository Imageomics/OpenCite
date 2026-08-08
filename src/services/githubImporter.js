import { createMetadata } from '../core/metadataModel.js';
import { extractOrcidFromGithubHtml, extractOrcidFromGithubProfile } from '../utils/orcid.js';
import { validateCitationCffText } from './citationValidation.js';
import { runCitationHealthScan } from './citationHealthScan.js';
import {
  fetchContentsFile,
  fetchLatestCommitDate,
  fetchOptionalJson,
  fetchRequiredJson,
  parseGithubUrl,
  resolveGithubToken,
} from './githubApi.js';
import {
  cleanString as utilCleanString,
  extractFirstMarkdownParagraph as utilExtractFirstMarkdownParagraph,
  firstNonEmpty as utilFirstNonEmpty,
  normalizeAuthor as utilNormalizeAuthor,
  normalizeAuthors as utilNormalizeAuthors,
  normalizeGrants as utilNormalizeGrants,
  normalizeKeywords as utilNormalizeKeywords,
  normalizeReferences as utilNormalizeReferences,
  normalizeRepoUrl as utilNormalizeRepoUrl,
  normalizeVersionForCompare as utilNormalizeVersionForCompare,
} from './githubImporterUtils.js';
import {
  fetchContributorAuthors,
  resolveContributorFallbackLimit,
} from './githubImporterContributors.js';
import {
  dedupeAuthors,
  enrichAuthorsWithContributorData,
  orderAuthorsByContributorRank,
} from './githubImporterAuthors.js';
import {
  parseCargoToml,
  parsePackageJson,
  parsePomXml,
  parsePyprojectToml,
  parseReadme,
  parseSetupPy,
} from './githubImporterParsers.js';
import { compareExistingMetadataFiles } from './metadataComparison.js';
import { runMetadataReviewPipeline } from './metadataReview.js';
import { validateZenodoJsonText } from './zenodoValidation.js';

const API_BASE = 'https://api.github.com';
const FILES_TO_INSPECT = [
  'CITATION.cff',
  '.zenodo.json',
  'README.md',
  'package.json',
  'pyproject.toml',
  'setup.py',
  'Cargo.toml',
  'pom.xml',
];

const cleanString = utilCleanString;
const firstNonEmpty = utilFirstNonEmpty;
const normalizeKeywords = utilNormalizeKeywords;
const normalizeReferences = utilNormalizeReferences;
const normalizeGrants = utilNormalizeGrants;
const normalizeAuthor = utilNormalizeAuthor;
const normalizeAuthors = utilNormalizeAuthors;
const normalizeRepoUrl = utilNormalizeRepoUrl;
const normalizeVersionForCompare = utilNormalizeVersionForCompare;
const extractFirstMarkdownParagraph = utilExtractFirstMarkdownParagraph;

function makeIssue(kind, source, code, message, details = {}) {
  return { kind, source, code, message, ...details };
}

function addWarning(warnings, source, code, message, details = {}) {
  warnings.push(makeIssue('warning', source, code, message, details));
}

function addError(errors, source, code, message, details = {}) {
  errors.push(makeIssue('error', source, code, message, details));
}

function addRateLimitHintIfNeeded(warnings, authToken) {
  if (authToken) {
    return;
  }

  const hasRateLimitWarning = warnings.some((warning) => warning.code === 'rate-limited');
  const alreadyHasHint = warnings.some((warning) => warning.code === 'rate-limit-hint');

  if (hasRateLimitWarning && !alreadyHasHint) {
    addWarning(
      warnings,
      'github-auth',
      'rate-limit-hint',
      'To reduce rate limits, pass authToken explicitly or set localStorage.opencite_github_token.',
    );
  }
}

function shouldInspectRepositoryFiles(options = {}) {
  return options.inspectRepositoryFiles !== false;
}

export function resolvePreferredCitationPath(fileContents = {}) {
  if (fileContents['CITATION.cff']) {
    return 'CITATION.cff';
  }

  return '';
}

export function validateImportedMetadataFiles(fileContents = {}) {
  return summarizeImportedMetadataFiles(fileContents).warnings;
}

export function summarizeImportedMetadataFiles(fileContents = {}) {
  const warnings = [];
  const summary = {
    citation: {
      present: false,
      valid: true,
      path: '',
      errors: [],
    },
    zenodo: {
      present: false,
      valid: true,
      path: '.zenodo.json',
      errors: [],
    },
    warnings,
  };
  const preferredCitationPath = resolvePreferredCitationPath(fileContents);

  if (preferredCitationPath) {
    const citationText = fileContents[preferredCitationPath];
    summary.citation.present = true;
    summary.citation.path = preferredCitationPath;

    const citationValidation = validateCitationCffText(citationText);
    if (!citationValidation.isValid) {
      summary.citation.valid = false;
      summary.citation.errors = [...citationValidation.errors];
      addWarning(
        warnings,
        'citation',
        'citation-file-invalid',
        `${preferredCitationPath} failed validation: ${citationValidation.errors.join(' | ')}`,
        { path: preferredCitationPath },
      );
    }

    for (const warning of citationValidation.warnings) {
      addWarning(warnings, 'citation', 'citation-file-warning', `${preferredCitationPath}: ${warning}`, { path: preferredCitationPath });
    }
  }

  const zenodoPath = '.zenodo.json';
  const zenodoText = fileContents[zenodoPath];
  if (zenodoText) {
    summary.zenodo.present = true;
    const zenodoValidation = validateZenodoJsonText(zenodoText);
    if (!zenodoValidation.isValid) {
      summary.zenodo.valid = false;
      summary.zenodo.errors = [...zenodoValidation.errors];
      addWarning(
        warnings,
        'zenodo',
        'zenodo-file-invalid',
        `${zenodoPath} failed validation: ${zenodoValidation.errors.join(' | ')}`,
        { path: zenodoPath },
      );
    }

    for (const warning of zenodoValidation.warnings) {
      addWarning(warnings, 'zenodo', 'zenodo-file-warning', `${zenodoPath}: ${warning}`, { path: zenodoPath });
    }
  }

  return summary;
}

export function parseCitationCff(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const result = {
    title: '',
    abstract: '',
    version: '',
    publicationDate: '',
    repositoryCode: '',
    license: '',
    doi: '',
    keywords: [],
    authors: [],
    references: [],
  };
  const parseWarnings = [];

  let section = 'top';
  let currentAuthor = null;
  let currentReference = null;

  const flushAuthor = () => {
    const hasAuthorData = currentAuthor && (
      currentAuthor.givenNames
      || currentAuthor.familyNames
      || currentAuthor['given-names']
      || currentAuthor['family-names']
      || currentAuthor.orcid
      || currentAuthor.affiliation
    );

    if (hasAuthorData) {
      result.authors.push(currentAuthor);
    }

    currentAuthor = null;
  };

  const flushReference = () => {
    if (!currentReference || typeof currentReference !== 'object') {
      currentReference = null;
      return;
    }

    const doi = cleanString(currentReference.doi ?? currentReference.DOI ?? '');
    const url = cleanString(currentReference.url ?? currentReference.link ?? currentReference.value ?? '');
    const title = cleanString(currentReference.title ?? currentReference['article-title'] ?? currentReference.reference ?? currentReference.text ?? '');

    if (doi) {
      result.references.push(/^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi}`);
      currentReference = null;
      return;
    }

    if (url) {
      result.references.push(url);
      currentReference = null;
      return;
    }

    if (title) {
      result.references.push(title);
    }

    currentReference = null;
  };

  const assignScalar = (key, value) => {
    const normalized = cleanString(value).replace(/^"|"$/g, '');

    if (!normalized) {
      return;
    }

    if (key === 'title') result.title = normalized;
    if (key === 'version') result.version = normalized;
    if (key === 'date-released') result.publicationDate = normalized;
    if (key === 'repository-code') result.repositoryCode = normalized;
    if (key === 'license') result.license = normalized;
    if (key === 'doi') result.doi = normalized;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (section === 'authors') {
      if (indent === 0 && !trimmed.startsWith('-')) {
        flushAuthor();
        section = 'top';
        index -= 1;
        continue;
      }

      if (trimmed.startsWith('-')) {
        flushAuthor();
        currentAuthor = {};
        const inline = trimmed.slice(1).trim();
        const inlineMatch = inline.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (inlineMatch) {
          const [, key, value] = inlineMatch;
          currentAuthor[key] = cleanString(value).replace(/^"|"$/g, '');
        }
        continue;
      }

      if (currentAuthor) {
        const authorMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (authorMatch) {
          const [, key, value] = authorMatch;
          currentAuthor[key] = cleanString(value).replace(/^"|"$/g, '');
        }
      }

      continue;
    }

    if (section === 'keywords') {
      if (indent === 0 && !trimmed.startsWith('-')) {
        section = 'top';
        index -= 1;
        continue;
      }

      if (trimmed.startsWith('-')) {
        const value = cleanString(trimmed.slice(1)).replace(/^"|"$/g, '');
        result.keywords.push(value);
      }

      continue;
    }

    if (section === 'references') {
      if (indent === 0 && !trimmed.startsWith('-')) {
        flushReference();
        section = 'top';
        index -= 1;
        continue;
      }

      if (trimmed.startsWith('-')) {
        flushReference();

        const inline = cleanString(trimmed.slice(1)).replace(/^"|"$/g, '');
        if (!inline) {
          currentReference = {};
          continue;
        }

        const inlineMatch = inline.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (inlineMatch) {
          const [, key, value] = inlineMatch;
          currentReference = {
            [key]: cleanString(value).replace(/^"|"$/g, ''),
          };
        } else {
          result.references.push(inline);
          currentReference = null;
        }

        continue;
      }

      if (currentReference) {
        const referenceMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (referenceMatch) {
          const [, key, value] = referenceMatch;
          currentReference[key] = cleanString(value).replace(/^"|"$/g, '');
        }
      }

      continue;
    }

    const abstractMatch = trimmed.match(/^abstract:\s*(.*)$/i);
    if (abstractMatch) {
      const value = cleanString(abstractMatch[1]).replace(/^"|"$/g, '');
      if (value && !/^[>|]/.test(value)) {
        result.abstract = value;
      } else {
        const block = [];
        for (let j = index + 1; j < lines.length; j += 1) {
          const nextLine = lines[j];
          const nextTrimmed = nextLine.trim();
          const nextIndent = nextLine.match(/^\s*/)?.[0].length ?? 0;
          if (nextTrimmed && nextIndent <= indent) {
            break;
          }
          if (nextIndent > indent) {
            block.push(nextLine.slice(Math.min(nextLine.length, indent + 2)));
          } else {
            block.push('');
          }
          index = j;
        }
        result.abstract = block.join('\n').trim();
      }
      continue;
    }

    if (/^keywords:\s*$/i.test(trimmed)) {
      section = 'keywords';
      continue;
    }

    if (/^authors:\s*$/i.test(trimmed)) {
      section = 'authors';
      continue;
    }

    if (/^references:\s*$/i.test(trimmed)) {
      section = 'references';
      continue;
    }

    if (/^preferred-citation:\s*$/i.test(trimmed)) {
      parseWarnings.push('preferred-citation section is not fully parsed during import; using top-level citation fields.');
      continue;
    }

    const scalarMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (scalarMatch) {
      assignScalar(scalarMatch[1], scalarMatch[2]);
    }
  }

  flushAuthor();
  flushReference();

  return {
    ...result,
    keywords: normalizeKeywords(result.keywords),
    authors: normalizeAuthors(result.authors),
    references: normalizeReferences(result.references),
    _warnings: parseWarnings,
  };
}

function parseJsonSafely(text) {
  return JSON.parse(text);
}

export function parseZenodoJson(text) {
  const payload = parseJsonSafely(text);

  const creators = Array.isArray(payload.creators) ? payload.creators.map((creator) => normalizeAuthor(creator)).filter(Boolean) : [];

  const grants = Array.isArray(payload.grants)
    ? payload.grants.map((grant) => cleanString(grant?.id ?? grant?.value ?? '')).filter(Boolean)
    : [];

  const references = Array.isArray(payload.references)
    ? payload.references.map((reference) => {
        if (typeof reference === 'string') {
          return cleanString(reference);
        }

        if (reference && typeof reference === 'object') {
          return cleanString(reference.text ?? reference.reference ?? reference.id ?? '');
        }

        return '';
      }).filter(Boolean)
    : [];

  return {
    title: cleanString(payload.title ?? ''),
    abstract: cleanString(payload.description ?? ''),
    version: cleanString(payload.version ?? ''),
    publicationDate: cleanString(payload.publication_date ?? ''),
    repositoryCode: normalizeRepoUrl(payload.repository ?? payload.url ?? ''),
    license: cleanString(typeof payload.license === 'string' ? payload.license : payload.license?.id ?? payload.license?.name ?? ''),
    doi: cleanString(payload.doi ?? ''),
    keywords: normalizeKeywords(payload.keywords),
    authors: creators,
    references,
    grants,
  };
}

function parseFile(path, text, warnings, errors) {
  try {
    if (path === '.zenodo.json') {
      return parseZenodoJson(text);
    }

    if (path === 'CITATION.cff') {
      const parsed = parseCitationCff(text);
      if (Array.isArray(parsed._warnings)) {
        for (const warning of parsed._warnings) {
          addWarning(warnings, 'parser', 'citation-partial-parse', warning, { path });
        }
      }
      const { _warnings, ...safeParsed } = parsed;
      return safeParsed;
    }

    if (path === 'package.json') {
      return parsePackageJson(text);
    }

    if (path === 'pyproject.toml') {
      return parsePyprojectToml(text);
    }

    if (path === 'setup.py') {
      return parseSetupPy(text);
    }

    if (path === 'Cargo.toml') {
      return parseCargoToml(text);
    }

    if (path === 'pom.xml') {
      return parsePomXml(text);
    }

    if (path === 'README.md') {
      return { abstract: parseReadme(text) };
    }
  } catch (error) {
    addWarning(warnings, 'parser', 'parse-failed', `Could not parse ${path}. ${error instanceof Error ? error.message : String(error)}`, { path });
    return null;
  }

  addError(errors, 'parser', 'unsupported-file', `Unsupported file: ${path}`, { path });
  return null;
}

function mapTypeOfWork(value) {
  const type = cleanString(value).toLowerCase();

  if (type === 'dataset') {
    return 'dataset';
  }

  if (['article', 'book', 'book-chapter', 'conference-paper', 'journal-article', 'manuscript', 'preprint', 'report', 'thesis'].includes(type)) {
    return 'article';
  }

  if (type === 'other') {
    return 'other';
  }

  return 'software';
}

function mergeMetadata({
  repo,
  release,
  defaultPublicationDate,
  citation,
  zenodo,
  packageMeta,
  readme,
  contributors,
  contributorLookupAuthors,
  supplementalCitationAuthors = [],
}) {
  const primaryAuthors = [
    ...normalizeAuthors(Array.isArray(citation?.authors) ? citation.authors : []),
    ...normalizeAuthors(Array.isArray(zenodo?.authors) ? zenodo.authors : []),
    ...normalizeAuthors(Array.isArray(packageMeta?.authors) ? packageMeta.authors : []),
    ...normalizeAuthors(Array.isArray(supplementalCitationAuthors) ? supplementalCitationAuthors : []),
  ];
  const authors = [
    ...normalizeAuthors(primaryAuthors),
    ...normalizeAuthors(Array.isArray(contributors) ? contributors : []),
  ];
  const keywords = normalizeKeywords(firstNonEmpty(citation?.keywords, zenodo?.keywords, packageMeta?.keywords, repo?.topics));
  const references = normalizeReferences(firstNonEmpty(zenodo?.references, citation?.references));
  const grants = normalizeGrants(firstNonEmpty(zenodo?.grants));
  const enrichedAuthors = enrichAuthorsWithContributorData(authors, contributorLookupAuthors);
  const dedupedAuthors = dedupeAuthors(enrichedAuthors);
  const orderedAuthors = orderAuthorsByContributorRank(dedupedAuthors, contributorLookupAuthors);

  return createMetadata({
    title: cleanString(firstNonEmpty(citation?.title, zenodo?.title, packageMeta?.title, repo?.name)),
    authors: orderedAuthors,
    keywords,
    license: cleanString(firstNonEmpty(citation?.license, zenodo?.license, packageMeta?.license, repo?.license?.spdx_id)),
    typeOfWork: mapTypeOfWork(firstNonEmpty(zenodo?.typeOfWork, citation?.typeOfWork, 'software')),
    customTypeOfWork: '',
    zenodoUploadType: mapTypeOfWork(firstNonEmpty(zenodo?.typeOfWork, citation?.typeOfWork, 'software')),
    // Prefer metadata file versions for pre-release authoring; fall back to latest release tag.
    version: cleanString(firstNonEmpty(citation?.version, zenodo?.version, packageMeta?.version, release?.tag_name)),
    publicationDate: cleanString(firstNonEmpty(release?.published_at, citation?.publicationDate, zenodo?.publicationDate, defaultPublicationDate)).split('T')[0],
    repositoryCode: normalizeRepoUrl(firstNonEmpty(repo?.html_url, citation?.repositoryCode, packageMeta?.repositoryCode)),
    doi: cleanString(firstNonEmpty(zenodo?.doi, citation?.doi)),
    abstract: cleanString(firstNonEmpty(citation?.abstract, zenodo?.abstract, packageMeta?.abstract, readme, repo?.description)),
    references,
    grants,
  });
}

export function addCitationConsistencyWarnings({ warnings, citation, zenodo, releaseData, repoData, metadata }) {
  const releaseTag = cleanString(releaseData?.tag_name ?? '');
  const citationVersion = cleanString(citation?.version ?? '');
  const zenodoVersion = cleanString(zenodo?.version ?? '');
  const finalVersion = cleanString(metadata?.version ?? '');
  const normalizedReleaseTag = normalizeVersionForCompare(releaseTag);
  const normalizedCitationVersion = normalizeVersionForCompare(citationVersion);
  const normalizedZenodoVersion = normalizeVersionForCompare(zenodoVersion);

  if (normalizedReleaseTag && normalizedCitationVersion && normalizedReleaseTag !== normalizedCitationVersion) {
    addWarning(
      warnings,
      'citation',
      'version-mismatch',
      `CITATION.cff version (${citationVersion}) differs from latest release tag (${releaseTag}); using CITATION.cff version for import.`,
    );
  }

  if (normalizedReleaseTag && normalizedZenodoVersion && normalizedReleaseTag !== normalizedZenodoVersion) {
    addWarning(
      warnings,
      'zenodo',
      'version-mismatch',
      `.zenodo.json version (${zenodoVersion}) differs from latest release tag (${releaseTag}); using .zenodo.json version for import.`,
    );
  }

  if (normalizedCitationVersion && normalizedZenodoVersion && normalizedCitationVersion !== normalizedZenodoVersion) {
    addWarning(
      warnings,
      'citation',
      'cross-file-version-mismatch',
      `CITATION.cff version (${citationVersion}) and .zenodo.json version (${zenodoVersion}) differ.`,
    );
  }

  const citationDate = cleanString(citation?.publicationDate ?? '').split('T')[0];
  const zenodoDate = cleanString(zenodo?.publicationDate ?? '').split('T')[0];
  const releaseDate = cleanString(releaseData?.published_at ?? '').split('T')[0];

  if (releaseDate && citationDate && releaseDate !== citationDate) {
    addWarning(
      warnings,
      'citation',
      'date-mismatch',
      `CITATION.cff date-released (${citationDate}) differs from latest release date (${releaseDate}); using release date for import.`,
    );
  }

  if (releaseDate && zenodoDate && releaseDate !== zenodoDate) {
    addWarning(
      warnings,
      'zenodo',
      'date-mismatch',
      `.zenodo.json publication_date (${zenodoDate}) differs from latest release date (${releaseDate}); using release date for import.`,
    );
  }

  const repoUrl = normalizeRepoUrl(repoData?.html_url ?? '');
  const citationRepoUrl = normalizeRepoUrl(citation?.repositoryCode ?? '');

  if (repoUrl && citationRepoUrl && repoUrl !== citationRepoUrl) {
    addWarning(
      warnings,
      'citation',
      'repository-url-mismatch',
      `CITATION.cff repository-code (${citationRepoUrl}) differs from repository URL (${repoUrl}); using repository URL for import.`,
    );
  }

  if (!finalVersion) {
    addWarning(
      warnings,
      'citation',
      'missing-version',
      'No version could be determined from release tag, CITATION.cff, .zenodo.json, or package metadata.',
    );
  }

  const repoSpdx = cleanString(repoData?.license?.spdx_id ?? '').toUpperCase();
  const citationLicense = cleanString(citation?.license ?? '').toUpperCase();
  const zenodoLicense = cleanString(zenodo?.license ?? '').toUpperCase();

  if (repoSpdx && citationLicense && repoSpdx !== citationLicense) {
    addWarning(
      warnings,
      'citation',
      'license-mismatch',
      `CITATION.cff license (${citationLicense}) differs from repository SPDX license (${repoSpdx}); imported metadata keeps source precedence but should be reviewed.`,
    );
  }

  if (repoSpdx && zenodoLicense && repoSpdx !== zenodoLicense) {
    addWarning(
      warnings,
      'zenodo',
      'license-mismatch',
      `.zenodo.json license (${zenodoLicense}) differs from repository SPDX license (${repoSpdx}); imported metadata keeps source precedence but should be reviewed.`,
    );
  }
}

export async function importGithubMetadata(repoUrl, options = {}) {
  const warnings = [];
  const errors = [];
  const emptyMetadata = createMetadata({ authors: [], keywords: [], references: [], grants: [] });
  const authToken = resolveGithubToken(options);
  const inspectRepositoryFiles = shouldInspectRepositoryFiles(options);
  const contributorFallbackLimit = resolveContributorFallbackLimit(options);

  let owner;
  let repo;

  try {
    ({ owner, repo } = parseGithubUrl(repoUrl));
  } catch (error) {
    addError(errors, 'url', 'invalid-url', error instanceof Error ? error.message : String(error));
    return { metadata: emptyMetadata, warnings, errors, review: null, healthScan: [] };
  }

  const repoData = await fetchRequiredJson(`${API_BASE}/repos/${owner}/${repo}`, {
    authToken,
    source: 'repository',
    onError: (source, code, message, details = {}) => addError(errors, source, code, message, details),
  });
  if (!repoData) {
    return { metadata: emptyMetadata, warnings, errors, review: null, healthScan: [] };
  }

  const defaultBranch = cleanString(repoData.default_branch ?? '');
  const releaseData = await fetchOptionalJson(`${API_BASE}/repos/${owner}/${repo}/releases/latest`, {
    authToken,
    source: 'release',
    label: 'the latest release',
    onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
  });
  const latestCommitDate = releaseData?.published_at
    ? ''
    : await fetchLatestCommitDate(owner, repo, defaultBranch, {
        authToken,
        onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
      });

  const parsedFiles = {};
  const fileContents = {};

  let ref = 'HEAD';

  if (inspectRepositoryFiles) {
    const branchInfo = defaultBranch
      ? await fetchOptionalJson(`${API_BASE}/repos/${owner}/${repo}/branches/${encodeURIComponent(defaultBranch)}`, {
          authToken,
          source: 'branch',
          label: 'the default branch',
          onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
        })
      : null;

    ref = cleanString(branchInfo?.name ?? defaultBranch ?? repoData.default_branch ?? 'HEAD');

    const fileEntries = await Promise.all(
      FILES_TO_INSPECT.map(async (filePath) => [
        filePath,
        await fetchContentsFile(owner, repo, filePath, ref, {
          authToken,
          onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
        }),
      ]),
    );

    Object.assign(fileContents, Object.fromEntries(fileEntries));
    const preferredCitationPath = resolvePreferredCitationPath(fileContents);

    for (const filePath of FILES_TO_INSPECT) {
      if (
        filePath === 'CITATION.cff'
        && preferredCitationPath
        && filePath !== preferredCitationPath
      ) {
        continue;
      }

      const text = fileContents[filePath];
      if (!text) continue;

      const parsed = parseFile(filePath, text, warnings, errors);
      if (parsed) {
        const parsedKey = (filePath === 'CITATION.cff')
          ? 'CITATION.cff'
          : filePath.toLowerCase();
        parsedFiles[parsedKey] = parsed;
      }
    }
  }

  const fileValidationSummary = summarizeImportedMetadataFiles(fileContents);

  for (const validationWarning of fileValidationSummary.warnings) {
    warnings.push(validationWarning);
  }

  const citationForComparison = parsedFiles['CITATION.cff'] ?? null;
  const zenodoForComparison = parsedFiles['.zenodo.json'] ?? null;

  let citation = citationForComparison;
  let zenodo = zenodoForComparison;
  let supplementalCitationAuthors = [];

  if (fileValidationSummary.citation.present && !fileValidationSummary.citation.valid) {
    // Discard invalid citation metadata fields, but keep parsed authors for attribution.
    supplementalCitationAuthors = normalizeAuthors(citationForComparison?.authors ?? []);
    citation = null;
    addWarning(
      warnings,
      'citation',
      'citation-file-skipped',
      `${fileValidationSummary.citation.path || 'CITATION.cff'} is invalid; ignoring non-author citation fields to avoid propagating incorrect values, but preserving parsed author entries and continuing with repository/package/README/contributor fallback metadata.`,
      { path: fileValidationSummary.citation.path || 'CITATION.cff' },
    );
  }

  if (fileValidationSummary.zenodo.present && !fileValidationSummary.zenodo.valid) {
    zenodo = null;
    addWarning(
      warnings,
      'zenodo',
      'zenodo-file-skipped',
      '.zenodo.json is invalid; ignoring imported Zenodo metadata to avoid propagating incorrect values and continuing with repository/package/README/contributor fallback metadata.',
      { path: '.zenodo.json' },
    );
  }

  const packageMeta = parsedFiles['package.json'] || parsedFiles['pyproject.toml'] || parsedFiles['setup.py'] || parsedFiles['cargo.toml'] || parsedFiles['pom.xml'];
  const readme = parsedFiles['readme.md']?.abstract || '';
  const hasPrimaryAuthors = firstNonEmpty(citation?.authors, zenodo?.authors, packageMeta?.authors, supplementalCitationAuthors).length > 0;

  const contributorResult = await fetchContributorAuthors({
    owner,
    repo,
    warnings,
    authToken,
    contributorFallbackLimit,
    emitFallbackWarning: !hasPrimaryAuthors,
    cleanString,
    normalizeAuthor,
    normalizeAuthors,
    dedupeAuthors,
    addWarning,
    fetchOptionalJson,
    extractOrcidFromGithubProfile,
    extractOrcidFromGithubHtml,
  });
  const contributors = contributorResult.fallbackAuthors.filter(Boolean);
  const contributorLookupAuthors = contributorResult.lookupAuthors.filter(Boolean);

  addRateLimitHintIfNeeded(warnings, authToken);

  if (!firstNonEmpty(citation?.authors, zenodo?.authors, packageMeta?.authors, contributors).length) {
    addWarning(warnings, 'authors', 'missing-authors', 'No author names found in repository metadata.', { owner, repo });
  }

  const metadata = mergeMetadata({
    repo: repoData,
    release: releaseData,
    defaultPublicationDate: latestCommitDate,
    citation,
    zenodo,
    packageMeta,
    readme,
    contributors,
    contributorLookupAuthors,
    supplementalCitationAuthors,
  });

  if (!metadata.repositoryCode) {
    metadata.repositoryCode = normalizeRepoUrl(repoData.html_url ?? `https://github.com/${owner}/${repo}`);
  }

  if (!metadata.version && releaseData?.tag_name) {
    metadata.version = cleanString(releaseData.tag_name);
  }

  if (!metadata.publicationDate) {
    metadata.publicationDate = cleanString(releaseData?.published_at ?? latestCommitDate ?? repoData.created_at).split('T')[0];
  }

  addCitationConsistencyWarnings({
    warnings,
    citation,
    zenodo,
    releaseData,
    repoData,
    metadata,
  });

  const review = runMetadataReviewPipeline({
    warnings,
    errors,
    metadata,
    repoData,
    releaseData,
    fileValidationSummary,
    citation,
    zenodo,
    packageMeta,
  });

  const healthScan = runCitationHealthScan({
    warnings,
    errors,
    metadata,
    repoData,
    releaseData,
    fileValidationSummary,
    citation,
    zenodo,
    packageMeta,
  });

  const comparisons = compareExistingMetadataFiles({
    repoData,
    releaseData,
    fileValidationSummary,
    citationForComparison,
    zenodoForComparison,
    contributorLookupAuthors,
  });

  return { metadata, warnings, errors, review, healthScan, comparisons };
}

