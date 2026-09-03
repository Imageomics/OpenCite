export function normalizeGrants(grantsText) {
  return String(grantsText ?? '')
    .split('\n')
    .map((grantLine) => grantLine.trim())
    .filter(Boolean);
}
