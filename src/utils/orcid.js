const ORCID_ID_PATTERN = /\b(\d{4}-\d{4}-\d{4}-\d{3}[0-9X])\b/i;
const ORCID_URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?orcid\.org\/(\d{4}-\d{4}-\d{4}-\d{3}[0-9X])/i;

export function normalizeOrcid(orcid) {
  const raw = String(orcid ?? '').trim();
  const stripped = stripOrcidUrl(raw).toUpperCase();

  if (!raw) return '';

  if (stripped && isValidOrcidFormat(stripped)) {
    return `https://orcid.org/${stripped}`;
  }

  return `https://orcid.org/${raw}`;
}

export function stripOrcidUrl(orcid) {
  return String(orcid ?? '')
    .replace(/^https?:\/\/(www\.)?orcid\.org\//i, '')
    .trim();
}

export function isValidOrcidFormat(orcid) {
  const id = stripOrcidUrl(orcid).toUpperCase();
  if (!id) {
    return true;
  }

  if (!ORCID_ID_PATTERN.test(id)) {
    return false;
  }

  const digits = id.replace(/-/g, '');
  let total = 0;

  for (let index = 0; index < 15; index += 1) {
    const digit = Number(digits[index]);
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
      return false;
    }

    total = (total + digit) * 2;
  }

  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  const checkDigit = result === 10 ? 'X' : String(result);

  return digits[15] === checkDigit;
}

export function extractOrcidFromText(value) {
  const text = String(value ?? '').trim().replace(/[<>()]/g, ' ');
  if (!text) {
    return null;
  }

  const urlMatch = text.match(ORCID_URL_PATTERN);
  if (urlMatch?.[1]) {
    return normalizeOrcid(urlMatch[1].toUpperCase());
  }

  const idMatch = text.match(ORCID_ID_PATTERN);
  if (idMatch?.[1]) {
    return normalizeOrcid(idMatch[1].toUpperCase());
  }

  return null;
}

function extractOrcidFromUnknown(value) {
  if (typeof value === 'string') {
    return extractOrcidFromText(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = extractOrcidFromUnknown(item);
      if (match) {
        return match;
      }
    }

    return null;
  }

  if (value && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      const match = extractOrcidFromUnknown(nestedValue);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

export function extractOrcidFromGithubProfile(userProfile, socialAccounts = []) {
  return extractOrcidFromUnknown(socialAccounts)
    ?? extractOrcidFromUnknown(userProfile);
}

export function extractOrcidFromGithubHtml(html) {
  return extractOrcidFromText(String(html ?? '').replace(/&amp;/g, '&'));
}

export function toZenodoOrcid(orcid) {
  return stripOrcidUrl(orcid);
}
