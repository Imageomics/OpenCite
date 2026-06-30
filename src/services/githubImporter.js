import { createMetadata } from '../core/metadataModel.js';
import { normalizeOrcid } from '../utils/orcid.js';

const API_BASE = 'https://api.github.com';
const TOP_CONTRIBUTOR_FALLBACK_LIMIT = 4;
const MAX_CONTRIBUTOR_FALLBACK_LIMIT = 20;
const FILES_TO_INSPECT = [
  'CITATION.cff',
  'citation.cff',
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

  return text.replace(/^git\+/, '').replace(/\.git$/i, '');
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
    return atob(normalized);
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
      'To reduce rate limits, set VITE_GITHUB_TOKEN in your .env.local or set localStorage key opencite_github_token to a GitHub token with read access.',
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
      ? `GitHub API rate limit reached while fetching ${label}.`
      : `${label} unavailable: ${responseMessage(result, result.data)}`;
    addWarning(warnings, source, result.rateLimited ? 'rate-limited' : 'request-failed', message, { url });
    return null;
  }

  return result.data;
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
        ? `GitHub API rate limit reached while fetching ${path}.`
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

function shouldInspectRepositoryFiles(options = {}) {
  return options.inspectRepositoryFiles === true;
}

function resolveContributorFallbackLimit(options = {}) {
  const rawLimit = Number(options.contributorFallbackLimit);

  if (!Number.isFinite(rawLimit)) {
    return TOP_CONTRIBUTOR_FALLBACK_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_CONTRIBUTOR_FALLBACK_LIMIT);
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

function parseCitationCff(text) {
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

  let section = 'top';
  let currentAuthor = null;
  let currentReference = null;

  const flushAuthor = () => {
    if (currentAuthor && (currentAuthor.givenNames || currentAuthor.familyNames || currentAuthor.orcid || currentAuthor.affiliation)) {
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

    if (section === 'keywords' || section === 'references') {
      if (indent === 0 && !trimmed.startsWith('-')) {
        section = 'top';
        index -= 1;
        continue;
      }

      if (trimmed.startsWith('-')) {
        const value = cleanString(trimmed.slice(1)).replace(/^"|"$/g, '');
        if (section === 'keywords') {
          result.keywords.push(value);
        } else {
          result.references.push(value);
        }
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
  };
}

function parseJsonSafely(text) {
  return JSON.parse(text);
}

function parseZenodoJson(text) {
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

    if (path === 'CITATION.cff' || path === 'citation.cff') {
      return parseCitationCff(text);
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
    addWarning(warnings, 'parser', 'parse-failed', `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`, { path });
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

function mergeMetadata({ repo, release, citation, zenodo, packageMeta, readme, contributors }) {
  const authors = firstNonEmpty(citation?.authors, zenodo?.authors, packageMeta?.authors, contributors);
  const keywords = normalizeKeywords(firstNonEmpty(citation?.keywords, zenodo?.keywords, packageMeta?.keywords, repo?.topics));
  const references = normalizeReferences(firstNonEmpty(zenodo?.references, citation?.references));
  const grants = normalizeGrants(firstNonEmpty(zenodo?.grants));

  return createMetadata({
    title: cleanString(firstNonEmpty(citation?.title, zenodo?.title, packageMeta?.title, repo?.name)),
    authors: normalizeAuthors(authors),
    keywords,
    license: cleanString(firstNonEmpty(citation?.license, zenodo?.license, packageMeta?.license, repo?.license?.spdx_id)),
    typeOfWork: mapTypeOfWork(firstNonEmpty(zenodo?.typeOfWork, citation?.typeOfWork, 'software')),
    customTypeOfWork: '',
    zenodoUploadType: mapTypeOfWork(firstNonEmpty(zenodo?.typeOfWork, citation?.typeOfWork, 'software')),
    version: cleanString(firstNonEmpty(citation?.version, zenodo?.version, release?.tag_name, packageMeta?.version)),
    publicationDate: cleanString(firstNonEmpty(citation?.publicationDate, zenodo?.publicationDate, release?.published_at, repo?.created_at)).split('T')[0],
    repositoryCode: cleanString(firstNonEmpty(citation?.repositoryCode, packageMeta?.repositoryCode, repo?.html_url)),
    doi: cleanString(firstNonEmpty(zenodo?.doi, citation?.doi)),
    abstract: cleanString(firstNonEmpty(citation?.abstract, zenodo?.abstract, packageMeta?.abstract, readme, repo?.description)),
    references,
    grants,
  });
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
    return { metadata: emptyMetadata, warnings, errors };
  }

  const repoData = await fetchRequiredJson(`${API_BASE}/repos/${owner}/${repo}`, errors, 'repository', authToken);
  if (!repoData) {
    return { metadata: emptyMetadata, warnings, errors };
  }

  const defaultBranch = cleanString(repoData.default_branch ?? '');
const releaseData = await fetchOptionalJson(
  `${API_BASE}/repos/${owner}/${repo}/releases/latest`,
  warnings,
  'release',
  'the latest release',
  authToken,
);

const parsedFiles = {};

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

  const fileContents = Object.fromEntries(fileEntries);

  for (const filePath of FILES_TO_INSPECT) {
    const text = fileContents[filePath];
    if (!text) continue;

    const parsed = parseFile(filePath, text, warnings, errors);
    if (parsed) {
      parsedFiles[filePath.toLowerCase()] = parsed;
    }
  }
}

const citation = parsedFiles['citation.cff'];
  const zenodo = parsedFiles['.zenodo.json'];
  const packageMeta = parsedFiles['package.json'] || parsedFiles['pyproject.toml'] || parsedFiles['setup.py'] || parsedFiles['cargo.toml'] || parsedFiles['pom.xml'];
  const readme = parsedFiles['readme.md']?.abstract || '';

  const contributors = (await fetchContributorAuthors(owner, repo, warnings, authToken, contributorFallbackLimit)).filter(Boolean);

  addRateLimitHintIfNeeded(warnings, authToken);

  if (!firstNonEmpty(citation?.authors, zenodo?.authors, packageMeta?.authors, contributors).length) {
    addWarning(warnings, 'authors', 'missing-authors', 'No human-readable author names were found in the repository metadata.', { owner, repo });
  }

  const metadata = mergeMetadata({
    repo: repoData,
    release: releaseData,
    citation,
    zenodo,
    packageMeta,
    readme,
    contributors,
  });

  if (!metadata.repositoryCode) {
    metadata.repositoryCode = cleanString(repoData.html_url ?? `https://github.com/${owner}/${repo}`);
  }

  if (!metadata.version && releaseData?.tag_name) {
    metadata.version = cleanString(releaseData.tag_name);
  }

  if (!metadata.publicationDate) {
    metadata.publicationDate = cleanString(releaseData?.published_at ?? repoData.created_at).split('T')[0];
  }

  return { metadata, warnings, errors };
}

async function fetchContributorAuthors(owner, repo, warnings, authToken = '', contributorFallbackLimit = TOP_CONTRIBUTOR_FALLBACK_LIMIT) {
  const contributors = await fetchOptionalJson(
    `${API_BASE}/repos/${owner}/${repo}/contributors?per_page=${contributorFallbackLimit}`,
    warnings,
    'contributors',
    'contributors',
    authToken,
  ) || [];

  if (!Array.isArray(contributors) || contributors.length === 0) {
    return [];
  }

  addWarning(
    warnings,
    'authors',
    'commit-based-fallback',
    `Using top ${contributorFallbackLimit} contributors by commit activity as author fallback.`,
    { owner, repo },
  );

  const profiles = await Promise.all(
    contributors.slice(0, contributorFallbackLimit).map(async (contributor) => {
      const login = cleanString(contributor?.login ?? '');
      if (!login) {
        return { contributor, profile: null, author: null, excludedAutomated: false };
      }

      const profile = await fetchOptionalJson(
        `${API_BASE}/users/${encodeURIComponent(login)}`,
        warnings,
        'contributor-profile',
        `the profile for ${login}`,
        authToken,
      );

      if (isAutomatedContributor(contributor, profile)) {
        return { contributor, profile, author: null, excludedAutomated: true };
      }

      if (profile?.name) {
        return {
          contributor,
          profile,
          author: normalizeAuthor({
            name: profile.name,
            affiliation: profile.company ?? '',
          }),
          excludedAutomated: false,
        };
      }

      // Fallback to contributor login when profile name is missing.
      return {
        contributor,
        profile,
        author: normalizeAuthor({
          name: login,
          affiliation: '',
        }),
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
      `Excluded ${excludedAutomatedCount} automated contributor account(s) from author fallback.`,
      { owner, repo },
    );
  }

  return dedupeAuthors(profiles.map((entry) => entry?.author).filter(Boolean));
}

function dedupeAuthors(authors) {
  const seen = new Set();
  const deduped = [];

  for (const author of authors) {
    const key = [
      cleanString(author?.givenNames ?? '').toLowerCase(),
      cleanString(author?.familyNames ?? '').toLowerCase(),
      cleanString(author?.orcid ?? '').toLowerCase(),
    ].join('|');

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(author);
  }

  return deduped;
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
