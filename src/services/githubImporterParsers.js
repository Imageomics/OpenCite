import {
  cleanString as utilCleanString,
  extractFirstMarkdownParagraph as utilExtractFirstMarkdownParagraph,
  normalizeAuthor as utilNormalizeAuthor,
  normalizeKeywords as utilNormalizeKeywords,
  normalizeRepoUrl as utilNormalizeRepoUrl,
} from './githubImporterUtils.js';

const cleanString = utilCleanString;
const normalizeAuthor = utilNormalizeAuthor;
const normalizeKeywords = utilNormalizeKeywords;
const normalizeRepoUrl = utilNormalizeRepoUrl;
const extractFirstMarkdownParagraph = utilExtractFirstMarkdownParagraph;

function parseJson(text) {
  return JSON.parse(text);
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

export function parsePackageJson(text) {
  const payload = parseJson(text);

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

export function parsePyprojectToml(text) {
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

export function parseSetupPy(text) {
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

export function parseCargoToml(text) {
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

export function parsePomXml(text) {
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

export function parseReadme(text) {
  return extractFirstMarkdownParagraph(text);
}
