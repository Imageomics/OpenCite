export function normalizeOrcid(orcid) {
  const raw = String(orcid ?? '').trim();

  if (!raw) return '';

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  return `https://orcid.org/${raw}`;
}

export function toZenodoOrcid(orcid) {
  return String(orcid ?? '')
    .replace(/^https?:\/\/(www\.)?orcid\.org\//, '')
    .trim();
}
