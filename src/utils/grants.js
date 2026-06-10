export function normalizeGrants(grantsText) {
  return String(grantsText ?? '')
    .split('\n')
    .filter((grantLine) => grantLine.length > 0);
}
