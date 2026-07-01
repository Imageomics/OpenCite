export function normalizeOrcid(orcid) {
  const raw = String(orcid ?? '').trim();

  if (!raw) return '';

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
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

  return /^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/.test(id);
}

export function toZenodoOrcid(orcid) {
  return stripOrcidUrl(orcid);
}
