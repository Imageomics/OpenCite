import { createMetadata } from '../core/metadataModel.js';
import { extractOrcidFromGithubHtml, extractOrcidFromGithubProfile, normalizeOrcid } from '../utils/orcid.js';
import { validateCitationCffText } from './citationValidation.js';
import { runCitationHealthScan } from './citationHealthScan.js';
import { compareExistingMetadataFiles } from './metadataComparison.js';
import { runMetadataReviewPipeline } from './metadataReview.js';
import { validateZenodoJsonText } from './zenodoValidation.js';

const API_BASE = 'https://api.github.com';
const TOP_CONTRIBUTOR_FALLBACK_LIMIT = 4;
const MAX_CONTRIBUTOR_FALLBACK_LIMIT = 20;
const GITHUB_PAGE_SIZE = 100;
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

function makeIssue(kind, source, code, message, details = {}) {
  return { kind, source, code, message, ...details };
}

function addWarning(warnings, source, code, message, details = {}) {
  warnings.push(makeIssue('warning', source, code, message, details));
}

function addError(errors, source, code, message, details = {}) {
  errors.push(makeIssue('error', source, code, message, details));
}

function cleanString(value) {
  return String(value ?? '').replace(/[\t ]+/g, ' ').trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        return value;
      }
      continue;
    }

    const text = cleanString(value);
    if (text) {
      return text;
    }
  }

  return '';
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean);
  }

  if (!value) {
    return [];
  }

  return String(value)
    .split(/[\n,]/)
    .map((item) => cleanString(item))
    .filter(Boolean);
}

function normalizeKeywords(value) {
  return [...new Set(normalizeStringList(value).map((keyword) => keyword.toLowerCase()))];
}

function normalizeReferences(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean);
  }

  if (!value) {
    return [];
  }

  return String(value)
    .split(/\n+/)
    .map((item) => cleanString(item))
    .filter(Boolean);
}

function normalizeGrants(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return cleanString(item);
        }

        if (item && typeof item === 'object') {
          return cleanString(item.id ?? item.value ?? item.grantId ?? '');
        }

        return '';
      })
      .filter(Boolean);
  }

  if (!value) {
    return [];
  }

  return String(value)
    .split(/\n+/)
    .map((item) => cleanString(item))
    .filter(Boolean);
}

function capitalizeToken(token) {
  const text = cleanString(token);
  if (!text) {
    return '';
  }

  return text
    .split(/([\-'])/)
    .map((part) => {
      if (part === '-' || part === "'") {
        return part;
      }

      // Preserve mixed-case tokens (for example, McDonald) and normalize others.
      if (/[a-z]/.test(part) && /[A-Z]/.test(part)) {
        return part;
      }

      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

function capitalizeName(value) {
  return cleanString(value)
    .split(/\s+/)
    .map((part) => capitalizeToken(part))
    .filter(Boolean)
    .join(' ');
}

function humanizeIdentifier(value) {
  return cleanString(value)
    .replace(/[._-]+/g, ' ')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2');
}

function splitDisplayName(name) {
  const value = cleanString(name);

  if (!value) {
    return { givenNames: '', familyNames: '' };
  }

  if (value.includes(',')) {
    const [familyNames, ...givenParts] = value.split(',');
    return {
      givenNames: capitalizeName(givenParts.join(',').trim()),
      familyNames: capitalizeName(familyNames),
    };
  }

  const normalized = humanizeIdentifier(value);
  const parts = normalized.split(/\s+/).filter(Boolean);

  if (parts.length <= 1) {
    return { givenNames: capitalizeName(parts[0] ?? ''), familyNames: '' };
  }

  return {
    givenNames: capitalizeName(parts.slice(0, -1).join(' ')),
    familyNames: capitalizeName(parts[parts.length - 1]),
  };
}

function normalizeAuthor(input) {
  if (!input) {
    return null;
  }

  if (typeof input === 'string') {
    const { givenNames, familyNames } = splitDisplayName(input);
    return givenNames || familyNames ? { givenNames, familyNames, orcid: '', affiliation: '' } : null;
  }

  if (typeof input !== 'object') {
    return null;
  }

  const name = cleanString(input.name ?? input.fullName ?? input.full_name ?? input.creator_name ?? '');
  const parsedName = name ? splitDisplayName(name) : null;
  let givenNames = capitalizeName(input.givenNames ?? input['given-names'] ?? input.firstName ?? input.firstname ?? parsedName?.givenNames ?? '');
  let familyNames = capitalizeName(input.familyNames ?? input['family-names'] ?? input.lastName ?? input.lastname ?? parsedName?.familyNames ?? '');
  const affiliation = cleanString(input.affiliation ?? input.organization ?? input.company ?? input.institution ?? '');
  const orcid = normalizeOrcid(input.orcid ?? input.ORCID ?? input.orcidId ?? '');

  // Some sources put full names in a single first-name field without spaces.
  if (givenNames && !familyNames) {
    const reparsed = splitDisplayName(givenNames);
    if (reparsed.familyNames) {
      givenNames = reparsed.givenNames;
      familyNames = reparsed.familyNames;
    }
  }

  if (!givenNames && !familyNames && !affiliation && !orcid) {
    return null;
  }

  return { givenNames, familyNames, orcid, affiliation };
}

function normalizeAuthors(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeAuthor(item)).filter(Boolean);
}

function normalizeRepoUrl(value) {
  const text = cleanString(value);
  if (!text) {
    return '';
  }

  const trimmed = text.replace(/^git\+/, '').replace(/\.git$/i, '').replace(/\/+$/, '');

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    let pathname = parsed.pathname.replace(/\/+$/, '');
    if (host === 'github.com') {
      pathname = pathname.toLowerCase();
    }
    return `${parsed.protocol}//${host}${pathname}`;
  } catch {
    return trimmed;
  }
}

function normalizeVersionForCompare(value) {
  const text = cleanString(value).toLowerCase();
  if (!text) {
    return '';
  }

  // Treat v-prefixed tags and bare semver as equivalent for mismatch checks.
  return text.replace(/^v(?=\d)/, '');
}

function parseGithubUrl(repoUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(repoUrl);
  } catch {
    throw new Error('Invalid GitHub repository URL.');
  }

  const host = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'github.com') {
    throw new Error('Only GitHub repository URLs are supported.');
  }

  const parts = parsedUrl.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length < 2) {
    throw new Error('Expected a repository URL in the form https://github.com/owner/repo.');
  }

  const [owner, repoRaw] = parts;
  return { owner, repo: repoRaw.replace(/\.git$/i, '') };
}

function encodePath(path) {
  return String(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodeBase64(content) {
  const normalized = String(content ?? '').replace(/\s+/g, '');

  if (!normalized) {
    return '';
  }

  if (typeof atob === 'function') {
    const binary = atob(normalized);

    // Decode base64 as UTF-8 so non-ASCII metadata (for example accents) is preserved.
    if (typeof TextDecoder === 'function') {
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    }

    return binary;
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(normalized, 'base64').toString('utf8');
  }

  return '';
}

function responseMessage(response, payload) {
  if (payload && typeof payload === 'object' && payload.message) {
    return String(payload.message);
  }

  return `${response.status} ${response.statusText}`.trim();
}

function resolveGithubToken(options = {}) {
  const explicitToken = cleanString(options.authToken ?? '');
  if (explicitToken) {
    return explicitToken;
  }

  const envToken = cleanString(import.meta.env?.VITE_GITHUB_TOKEN ?? '');
  if (envToken) {
    return envToken;
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const localToken = cleanString(window.localStorage.getItem('opencite_github_token') ?? '');
      if (localToken) {
        return localToken;
      }
    }
  } catch {
    // localStorage access can fail in restricted browsing contexts.
  }

  return '';
}

function createGithubHeaders(token = '') {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
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
      'To reduce rate limits, set VITE_GITHUB_TOKEN in .env.local or set localStorage.opencite_github_token.',
    );
  }
}

async function fetchJson(url, authToken = '') {
  let response;

  try {
    response = await fetch(url, {
      headers: createGithubHeaders(authToken),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: 'Network error',
      data: null,
      rateLimited: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    data,
    rateLimited: response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0',
  };
}

async function fetchRequiredJson(url, errors, source, authToken = '') {
  const result = await fetchJson(url, authToken);

  if (!result.ok) {
    const message = result.rateLimited
      ? 'GitHub API rate limit exceeded.'
      : responseMessage(result, result.data);
    addError(errors, source, result.rateLimited ? 'rate-limited' : 'request-failed', message, { url });
    return null;
  }

  return result.data;
}

async function fetchOptionalJson(url, warnings, source, label, authToken = '') {
  const result = await fetchJson(url, authToken);

  if (!result.ok) {
    if (result.status === 404) {
      return null;
    }

    const message = result.rateLimited
      ? `GitHub API rate limit exceeded while fetching ${label}.`
      : `${label} unavailable: ${responseMessage(result, result.data)}`;
    addWarning(warnings, source, result.rateLimited ? 'rate-limited' : 'request-failed', message, { url });
    return null;
  }

  return result.data;
}

async function fetchLatestCommitDate(owner, repo, defaultBranch, warnings, authToken = '') {
  const branchFilter = defaultBranch ? `&sha=${encodeURIComponent(defaultBranch)}` : '';
  const commits = await fetchOptionalJson(
    `${API_BASE}/repos/${owner}/${repo}/commits?per_page=1${branchFilter}`,
    warnings,
    'commits',
    'the latest commit',
    authToken,
  );

  if (!Array.isArray(commits) || commits.length === 0) {
    return '';
  }

  return cleanString(commits[0]?.commit?.committer?.date ?? commits[0]?.commit?.author?.date ?? '');
}

async function fetchContentsFile(owner, repo, path, ref, warnings, authToken = '') {
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;
  const result = await fetchJson(url, authToken);

  if (!result.ok) {
    if (result.status === 404) {
      return null;
    }

    addWarning(
      warnings,
      'contents',
      result.rateLimited ? 'rate-limited' : 'request-failed',
      result.rateLimited
        ? `GitHub API rate limit exceeded while fetching ${path}.`
        : `Unable to fetch ${path}: ${responseMessage(result, result.data)}`,
      { path, url },
    );
    return null;
  }

  const payload = result.data;
  if (!payload || Array.isArray(payload)) {
    addWarning(warnings, 'contents', 'unexpected-response', `GitHub returned an unexpected payload for ${path}.`, { path, url });
    return null;
  }

  if (payload.truncated && payload.download_url) {
    const rawResult = await fetchJson(payload.download_url, authToken);
    if (rawResult.ok) {
      return typeof rawResult.data === 'string' ? rawResult.data : '';
    }

    addWarning(warnings, 'contents', 'request-failed', `Unable to fetch the full contents of ${path}.`, { path, url });
    return null;
  }

  if (payload.encoding === 'base64' && payload.content) {
    return decodeBase64(payload.content);
  }

  return '';
}

async function fetchOrcidFromGithubProfileHtml(profileUrl) {
  const url = cleanString(profileUrl);
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html',
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return extractOrcidFromGithubHtml(html);
  } catch {
    return null;
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

function resolveContributorFallbackLimit(options = {}) {
  if (!Object.prototype.hasOwnProperty.call(options, 'contributorFallbackLimit')) {
    return TOP_CONTRIBUTOR_FALLBACK_LIMIT;
  }

  if (options.contributorFallbackLimit == null || options.contributorFallbackLimit === '') {
    return null;
  }

  const rawLimit = Number(options.contributorFallbackLimit);

  if (!Number.isFinite(rawLimit)) {
    return TOP_CONTRIBUTOR_FALLBACK_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_CONTRIBUTOR_FALLBACK_LIMIT);
}

async function fetchAllContributors(owner, repo, warnings, authToken = '', maxContributors = null) {
  const contributors = [];
  let page = 1;

  while (true) {
    const pageContributors = await fetchOptionalJson(
      `${API_BASE}/repos/${owner}/${repo}/contributors?per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
      warnings,
      'contributors',
      `contributors page ${page}`,
      authToken,
    ) || [];

    if (!Array.isArray(pageContributors) || pageContributors.length === 0) {
      break;
    }

    contributors.push(...pageContributors);

    if (maxContributors && contributors.length >= maxContributors) {
      return contributors.slice(0, maxContributors);
    }

    if (pageContributors.length < GITHUB_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return contributors;
}

function extractFirstMarkdownParagraph(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const paragraph = [];
  let started = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (started) {
        break;
      }
      continue;
    }

    if (!started && /^#{1,6}\s+/.test(trimmed)) {
      started = true;
      continue;
    }

    if (!started && /^(!|\[|-)/.test(trimmed)) {
      continue;
    }

    started = true;
    paragraph.push(trimmed);
  }

  return paragraph.join(' ').replace(/\s+/g, ' ').trim();
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

function extractPackageAuthors(payload) {
  const candidates = [];

  if (payload.author) {
    candidates.push(payload.author);
  }

  if (Array.isArray(payload.authors)) {
    candidates.push(...payload.authors);
  }

  return candidates.map((item) => normalizeAuthor(item)).filter(Boolean);
}

function parsePackageJson(text) {
  const payload = parseJsonSafely(text);

  return {
    title: cleanString(payload.name ?? ''),
    abstract: cleanString(payload.description ?? ''),
    version: cleanString(payload.version ?? ''),
    repositoryCode: normalizeRepoUrl(typeof payload.repository === 'string' ? payload.repository : payload.repository?.url ?? payload.homepage ?? ''),
    license: cleanString(typeof payload.license === 'string' ? payload.license : payload.license?.type ?? ''),
    keywords: normalizeKeywords(payload.keywords),
    authors: extractPackageAuthors(payload),
  };
}

function extractTomlSection(text, sectionName) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const sectionLines = [];
  let inSection = false;

  for (const line of lines) {
    const sectionMatch = line.trim().match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      if (inSection) {
        break;
      }

      inSection = sectionMatch[1] === sectionName;
      continue;
    }

    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join('\n');
}

function extractTomlValue(sectionText, key) {
  const match = sectionText.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

function parseTomlString(sectionText, key) {
  const value = extractTomlValue(sectionText, key);
  const match = value.match(/^['"](.+?)['"]$/);
  return match ? match[1].trim() : '';
}

function parseTomlStrings(value) {
  return [...String(value ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((match) => cleanString(match[1])).filter(Boolean);
}

function parsePyprojectToml(text) {
  const section = extractTomlSection(text, 'project') || extractTomlSection(text, 'tool.poetry');
  const authorsBlock = extractTomlValue(section, 'authors') || extractTomlValue(section, 'maintainers');
  const authors = [...String(authorsBlock ?? '').matchAll(/name\s*=\s*['"]([^'"]+)['"]/g)]
    .map((match) => normalizeAuthor({ name: match[1] }))
    .filter(Boolean);

  const licenseValue = parseTomlString(section, 'license') || cleanString((section.match(/license\s*=\s*\{[^}]*text\s*=\s*['"]([^'"]+)['"][^}]*\}/s) || [])[1] ?? '');
  const repositoryCode = parseTomlString(section, 'repository') || parseTomlString(section, 'homepage') || parseTomlString(section, 'url');

  return {
    title: parseTomlString(section, 'name'),
    abstract: parseTomlString(section, 'description'),
    version: parseTomlString(section, 'version'),
    repositoryCode,
    license: licenseValue,
    keywords: normalizeKeywords(parseTomlStrings(extractTomlValue(section, 'keywords'))),
    authors,
  };
}

function parseSetupPy(text) {
  const source = String(text ?? '');
  const extract = (key) => cleanString((source.match(new RegExp(`${key}\\s*=\\s*['"]([^'"]+)['"]`, 'm')) || [])[1] ?? '');

  const authors = [];
  const author = extract('author');
  const maintainer = extract('maintainer');

  if (author) {
    authors.push(normalizeAuthor({ name: author }));
  } else if (maintainer) {
    authors.push(normalizeAuthor({ name: maintainer }));
  }

  return {
    title: extract('name'),
    abstract: extract('description'),
    version: extract('version'),
    repositoryCode: normalizeRepoUrl(extract('url')),
    license: extract('license'),
    keywords: normalizeKeywords(extract('keywords')),
    authors: authors.filter(Boolean),
  };
}

function parseCargoToml(text) {
  const section = extractTomlSection(text, 'package');
  const authors = parseTomlStrings(extractTomlValue(section, 'authors')).map((name) => normalizeAuthor({ name })).filter(Boolean);

  return {
    title: parseTomlString(section, 'name'),
    abstract: parseTomlString(section, 'description'),
    version: parseTomlString(section, 'version'),
    repositoryCode: parseTomlString(section, 'repository'),
    license: parseTomlString(section, 'license'),
    keywords: normalizeKeywords(parseTomlStrings(extractTomlValue(section, 'keywords'))),
    authors,
  };
}

function parsePomXml(text) {
  const source = String(text ?? '');
  const extract = (pattern) => cleanString((source.match(pattern) || [])[1] ?? '');
  const authors = [...source.matchAll(/<developer>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/developer>/g)]
    .map((match) => normalizeAuthor({ name: match[1] }))
    .filter(Boolean);

  const licenseMatch = source.match(/<license>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/license>/);

  return {
    title: extract(/<name>([^<]+)<\/name>/),
    abstract: extract(/<description>([^<]+)<\/description>/),
    version: extract(/<version>([^<]+)<\/version>/),
    repositoryCode: extract(/<url>([^<]+)<\/url>/),
    license: cleanString((licenseMatch || [])[1] ?? ''),
    keywords: [],
    authors,
  };
}

function parseReadme(text) {
  return extractFirstMarkdownParagraph(text);
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

function authorNameKey(author) {
  return [
    cleanString(author?.givenNames ?? '').toLowerCase(),
    cleanString(author?.familyNames ?? '').toLowerCase(),
  ].join('|');
}

function normalizeNameToken(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function authorMatchMetadata(author) {
  const givenNames = normalizeNameToken(author?.givenNames ?? '');
  const familyNames = normalizeNameToken(author?.familyNames ?? '');
  const givenTokens = givenNames.split(' ').filter(Boolean);
  const familyTokens = familyNames.split(' ').filter(Boolean);

  return {
    givenNames,
    familyNames,
    givenFirst: givenTokens[0] ?? '',
    givenInitials: givenTokens.map((token) => token[0]).join(''),
    familyLast: familyTokens[familyTokens.length - 1] ?? '',
    fullName: [givenNames, familyNames].filter(Boolean).join(' ').trim(),
  };
}

function authorAltNameKeys(author) {
  const metadata = authorMatchMetadata(author);
  const givenNames = metadata.givenNames;
  const familyNames = metadata.familyNames;
  const givenFirst = metadata.givenFirst;
  const familyLast = metadata.familyLast;
  const keys = new Set([
    `${givenNames}|${familyNames}`,
    `${givenFirst}|${familyNames}`,
    `${givenNames}|${familyLast}`,
    `${givenFirst}|${familyLast}`,
  ]);

  keys.delete('|');
  keys.delete('');
  return [...keys].filter(Boolean);
}

function authorsLikelyMatch(sourceAuthor, contributorAuthor) {
  const source = authorMatchMetadata(sourceAuthor);
  const contributor = authorMatchMetadata(contributorAuthor);

  if (!source.familyLast || !contributor.familyLast || source.familyLast !== contributor.familyLast) {
    return false;
  }

  if (source.givenNames && contributor.givenNames && source.givenNames === contributor.givenNames) {
    return true;
  }

  if (source.givenFirst && contributor.givenFirst && source.givenFirst === contributor.givenFirst) {
    return true;
  }

  if (source.givenInitials && contributor.givenInitials && source.givenInitials === contributor.givenInitials) {
    return true;
  }

  if (source.fullName && contributor.fullName && source.fullName === contributor.fullName) {
    return true;
  }

  return false;
}

function enrichAuthorsWithContributorData(sourceAuthors, contributorAuthors) {
  const normalizedSourceAuthors = normalizeAuthors(Array.isArray(sourceAuthors) ? sourceAuthors : []);
  if (normalizedSourceAuthors.length === 0) {
    return normalizeAuthors(Array.isArray(contributorAuthors) ? contributorAuthors : []);
  }

  const normalizedContributorAuthors = normalizeAuthors(Array.isArray(contributorAuthors) ? contributorAuthors : []);
  const contributorMatches = new Map();

  for (const contributorAuthor of normalizedContributorAuthors) {
    if (!contributorAuthor.orcid && !contributorAuthor.affiliation) {
      continue;
    }

    for (const key of authorAltNameKeys(contributorAuthor)) {
      const existing = contributorMatches.get(key) ?? [];
      existing.push(contributorAuthor);
      contributorMatches.set(key, existing);
    }
  }

  return normalizedSourceAuthors.map((author) => {
    const keyedMatches = authorAltNameKeys(author)
      .flatMap((key) => contributorMatches.get(key) ?? []);
    const heuristicMatches = normalizedContributorAuthors.filter((contributorAuthor) => authorsLikelyMatch(author, contributorAuthor));
    const matches = [...new Set([...keyedMatches, ...heuristicMatches])];
    const uniqueOrcids = [...new Set(matches.map((match) => match.orcid).filter(Boolean))];
    const uniqueAffiliations = [...new Set(matches.map((match) => match.affiliation).filter(Boolean))];

    if ((!author.orcid && uniqueOrcids.length > 1) || (!author.affiliation && uniqueAffiliations.length > 1)) {
      return author;
    }

    return {
      ...author,
      orcid: author.orcid || uniqueOrcids[0] || '',
      affiliation: author.affiliation || uniqueAffiliations[0] || '',
    };
  });
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
      `CITATION.cff version (${citationVersion}) differs from latest release tag (${releaseTag}); using the CITATION.cff version for import.`,
    );
  }

  if (normalizedReleaseTag && normalizedZenodoVersion && normalizedReleaseTag !== normalizedZenodoVersion) {
    addWarning(
      warnings,
      'zenodo',
      'version-mismatch',
      `.zenodo.json version (${zenodoVersion}) differs from latest release tag (${releaseTag}); using the .zenodo.json version for import.`,
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

  const repoData = await fetchRequiredJson(`${API_BASE}/repos/${owner}/${repo}`, errors, 'repository', authToken);
  if (!repoData) {
    return { metadata: emptyMetadata, warnings, errors, review: null, healthScan: [] };
  }

  const defaultBranch = cleanString(repoData.default_branch ?? '');
const releaseData = await fetchOptionalJson(
  `${API_BASE}/repos/${owner}/${repo}/releases/latest`,
  warnings,
  'release',
  'the latest release',
  authToken,
);
  const latestCommitDate = releaseData?.published_at
    ? ''
    : await fetchLatestCommitDate(owner, repo, defaultBranch, warnings, authToken);

const parsedFiles = {};
  const fileContents = {};

let ref = 'HEAD';

if (inspectRepositoryFiles) {
  const branchInfo = defaultBranch
    ? await fetchOptionalJson(
        `${API_BASE}/repos/${owner}/${repo}/branches/${encodeURIComponent(defaultBranch)}`,
        warnings,
        'branch',
        'the default branch',
        authToken,
      )
    : null;

  ref = cleanString(branchInfo?.name ?? defaultBranch ?? repoData.default_branch ?? 'HEAD');

  const fileEntries = await Promise.all(
    FILES_TO_INSPECT.map(async (filePath) => [
      filePath,
      await fetchContentsFile(owner, repo, filePath, ref, warnings, authToken),
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
    `${fileValidationSummary.citation.path || 'CITATION.cff'} is invalid; ignoring non-author citation fields to avoid propagating incorrect values, but preserving parsed author entries.`,
    { path: fileValidationSummary.citation.path || 'CITATION.cff' },
  );
}

if (fileValidationSummary.zenodo.present && !fileValidationSummary.zenodo.valid) {
  zenodo = null;
  addWarning(
    warnings,
    'zenodo',
    'zenodo-file-skipped',
    '.zenodo.json is invalid; ignoring imported Zenodo metadata to avoid propagating incorrect values.',
    { path: '.zenodo.json' },
  );
}

  const packageMeta = parsedFiles['package.json'] || parsedFiles['pyproject.toml'] || parsedFiles['setup.py'] || parsedFiles['cargo.toml'] || parsedFiles['pom.xml'];
  const readme = parsedFiles['readme.md']?.abstract || '';
  const hasPrimaryAuthors = firstNonEmpty(citation?.authors, zenodo?.authors, packageMeta?.authors, supplementalCitationAuthors).length > 0;

  const contributorResult = await fetchContributorAuthors(
    owner,
    repo,
    warnings,
    authToken,
    contributorFallbackLimit,
    !hasPrimaryAuthors,
  );
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

async function fetchContributorAuthors(
  owner,
  repo,
  warnings,
  authToken = '',
  contributorFallbackLimit = TOP_CONTRIBUTOR_FALLBACK_LIMIT,
  emitFallbackWarning = true,
) {
  const contributors = await fetchAllContributors(owner, repo, warnings, authToken, contributorFallbackLimit);

  if (!Array.isArray(contributors) || contributors.length === 0) {
    return {
      fallbackAuthors: [],
      lookupAuthors: [],
    };
  }

  if (emitFallbackWarning) {
    addWarning(
      warnings,
      'authors',
      'commit-based-fallback',
      contributorFallbackLimit
        ? `Using top ${contributorFallbackLimit} contributors as fallback authors.`
        : 'Using contributors as fallback authors.',
      { owner, repo },
    );
  }

  const profiles = await Promise.all(
    contributors.map(async (contributor) => {
      const login = cleanString(contributor?.login ?? '');
      if (!login) {
        return {
          contributor,
          profile: null,
          socialAccounts: [],
          author: null,
          autoFilledOrcid: false,
          excludedAutomated: false,
        };
      }

      const profile = await fetchOptionalJson(
        `${API_BASE}/users/${encodeURIComponent(login)}`,
        warnings,
        'contributor-profile',
        `the profile for ${login}`,
        authToken,
      );

      const socialAccounts = await fetchOptionalJson(
        `${API_BASE}/users/${encodeURIComponent(login)}/social_accounts`,
        warnings,
        'contributor-profile-links',
        `the profile links for ${login}`,
        authToken,
      ) || [];

      if (isAutomatedContributor(contributor, profile)) {
        return {
          contributor,
          profile,
          socialAccounts,
          author: null,
          autoFilledOrcid: false,
          excludedAutomated: true,
        };
      }

      let profileOrcid = extractOrcidFromGithubProfile(profile, socialAccounts);
      if (!profileOrcid) {
        profileOrcid = await fetchOrcidFromGithubProfileHtml(profile?.html_url ?? contributor?.html_url ?? '');
      }

      if (profile?.name) {
        return {
          contributor,
          profile,
          socialAccounts,
          author: normalizeAuthor({
            name: profile.name,
            affiliation: profile.company ?? '',
            orcid: profileOrcid,
          }),
          autoFilledOrcid: Boolean(profileOrcid),
          excludedAutomated: false,
        };
      }

      // Fallback to contributor login when profile name is missing.
      return {
        contributor,
        profile,
        socialAccounts,
        author: normalizeAuthor({
          name: login,
          affiliation: '',
          orcid: profileOrcid,
        }),
        autoFilledOrcid: Boolean(profileOrcid),
        excludedAutomated: false,
      };
    }),
  );

  const excludedAutomatedCount = profiles.filter((entry) => entry?.excludedAutomated).length;
  if (excludedAutomatedCount > 0) {
    addWarning(
      warnings,
      'authors',
      'automated-contributors-excluded',
      `Excluded ${excludedAutomatedCount} automated account(s) from fallback authors.`,
      { owner, repo },
    );
  }

  const autoFilledOrcidCount = profiles.filter((entry) => entry?.autoFilledOrcid).length;
  if (autoFilledOrcidCount > 0) {
    addWarning(
      warnings,
      'authors',
      'orcid-autofilled',
      `Auto-filled ORCID for ${autoFilledOrcidCount} contributor(s) from GitHub profile data.`,
      { owner, repo },
    );
  }

  const fallbackAuthors = profiles
    .slice(0, contributorFallbackLimit ?? profiles.length)
    .map((entry) => entry?.author);
  const lookupAuthors = profiles.map((entry) => entry?.author);

  return {
    fallbackAuthors: dedupeAuthors(normalizeAuthors(fallbackAuthors)),
    lookupAuthors: dedupeAuthors(normalizeAuthors(lookupAuthors)),
  };
}

function dedupeAuthors(authors) {
  const seen = new Set();
  const byOrcid = new Map();
  const byName = new Map();
  const deduped = [];

  for (const rawAuthor of authors) {
    const author = normalizeAuthor(rawAuthor);
    if (!author) {
      continue;
    }

    const orcidKey = cleanString(author?.orcid ?? '').toLowerCase();
    const nameKey = [
      cleanString(author?.givenNames ?? '').toLowerCase(),
      cleanString(author?.familyNames ?? '').toLowerCase(),
    ].join('|');

    if (nameKey !== '|' && byName.has(nameKey)) {
      const existing = byName.get(nameKey);
      const existingOrcid = cleanString(existing?.orcid ?? '').toLowerCase();
      const canMergeByName = !existingOrcid || !orcidKey || existingOrcid === orcidKey;

      if (canMergeByName) {
        if (!existing.orcid && author.orcid) {
          existing.orcid = author.orcid;
        }
        if (!existing.affiliation && author.affiliation) {
          existing.affiliation = author.affiliation;
        }
        if (orcidKey && !byOrcid.has(orcidKey)) {
          byOrcid.set(orcidKey, existing);
        }
        continue;
      }
    }

    const likelyMatch = deduped.find((existing) => {
      const existingOrcid = cleanString(existing?.orcid ?? '').toLowerCase();
      const hasConflictingOrcid = existingOrcid && orcidKey && existingOrcid !== orcidKey;

      if (hasConflictingOrcid) {
        return false;
      }

      return authorsLikelyMatch(existing, author);
    });

    if (likelyMatch) {
      if (!likelyMatch.orcid && author.orcid) {
        likelyMatch.orcid = author.orcid;
      }
      if (!likelyMatch.affiliation && author.affiliation) {
        likelyMatch.affiliation = author.affiliation;
      }

      const mergedOrcidKey = cleanString(likelyMatch?.orcid ?? '').toLowerCase();
      if (mergedOrcidKey && !byOrcid.has(mergedOrcidKey)) {
        byOrcid.set(mergedOrcidKey, likelyMatch);
      }
      continue;
    }

    if (orcidKey && byOrcid.has(orcidKey)) {
      const existing = byOrcid.get(orcidKey);
      if (!existing.affiliation && author.affiliation) {
        existing.affiliation = author.affiliation;
      }
      continue;
    }

    const key = [
      cleanString(author?.givenNames ?? '').toLowerCase(),
      cleanString(author?.familyNames ?? '').toLowerCase(),
      cleanString(author?.orcid ?? '').toLowerCase(),
    ].join('|');

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    const normalizedAuthor = { ...author };
    deduped.push(normalizedAuthor);

    if (orcidKey) {
      byOrcid.set(orcidKey, normalizedAuthor);
    }

    if (nameKey !== '|') {
      byName.set(nameKey, normalizedAuthor);
    }
  }

  return deduped;
}

function orderAuthorsByContributorRank(authors, contributorAuthors) {
  const normalizedAuthors = normalizeAuthors(Array.isArray(authors) ? authors : []);
  const normalizedContributors = normalizeAuthors(Array.isArray(contributorAuthors) ? contributorAuthors : []);

  if (normalizedContributors.length === 0 || normalizedAuthors.length <= 1) {
    return normalizedAuthors;
  }

  const contributorOrcidIndex = new Map();
  const contributorNameKeyIndex = new Map();

  normalizedContributors.forEach((contributorAuthor, index) => {
    const orcidKey = cleanString(contributorAuthor?.orcid ?? '').toLowerCase();
    if (orcidKey && !contributorOrcidIndex.has(orcidKey)) {
      contributorOrcidIndex.set(orcidKey, index);
    }

    for (const key of authorAltNameKeys(contributorAuthor)) {
      if (!contributorNameKeyIndex.has(key)) {
        contributorNameKeyIndex.set(key, index);
      }
    }
  });

  const ranked = normalizedAuthors.map((author, originalIndex) => {
    const orcidKey = cleanString(author?.orcid ?? '').toLowerCase();
    if (orcidKey && contributorOrcidIndex.has(orcidKey)) {
      return { author, originalIndex, rank: contributorOrcidIndex.get(orcidKey) };
    }

    const nameRanks = authorAltNameKeys(author)
      .map((key) => contributorNameKeyIndex.get(key))
      .filter((value) => Number.isInteger(value));

    if (nameRanks.length > 0) {
      return { author, originalIndex, rank: Math.min(...nameRanks) };
    }

    const heuristicIndex = normalizedContributors.findIndex((contributorAuthor) => authorsLikelyMatch(author, contributorAuthor));
    if (heuristicIndex >= 0) {
      return { author, originalIndex, rank: heuristicIndex };
    }

    return { author, originalIndex, rank: Number.POSITIVE_INFINITY };
  });

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }

    return left.originalIndex - right.originalIndex;
  });

  return ranked.map((entry) => entry.author);
}

function isAutomatedContributor(contributor, profile) {
  const login = cleanString(profile?.login ?? contributor?.login ?? '').toLowerCase();
  const contributorType = cleanString(contributor?.type ?? '').toLowerCase();
  const profileType = cleanString(profile?.type ?? '').toLowerCase();

  if ((contributorType && contributorType !== 'user') || (profileType && profileType !== 'user')) {
    return true;
  }

  if (!login) {
    return false;
  }

  if (login.endsWith('[bot]')) {
    return true;
  }

  return /(^|[-_])(github-actions|dependabot|copilot|codex|claude|swe-agent)([-_]|$)/.test(login);
}
