export function normalizeReferences(referencesText) {
  return String(referencesText ?? '')
    .split('\n')
    .map((reference) => reference.trim())
    .filter(Boolean);
}
