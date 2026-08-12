import { normalizeOrcid } from '../utils/orcid.js';

function cleanString(value) {
  return String(value ?? '').replace(/[\t ]+/g, ' ').trim();
}

function stripWrappingQuotes(value) {
  const text = cleanString(value);
  if (!text) {
    return '';
  }

  return text.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
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

  return text.replace(/^v(?=\d)/, '');
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

export {
  cleanString,
  extractFirstMarkdownParagraph,
  firstNonEmpty,
  normalizeAuthor,
  normalizeAuthors,
  normalizeGrants,
  normalizeKeywords,
  normalizeReferences,
  normalizeRepoUrl,
  normalizeVersionForCompare,
  stripWrappingQuotes,
};
