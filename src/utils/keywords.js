export function normalizeKeywords(keywordsString) {
  return [...new Set(
    String(keywordsString ?? '')
      .split(',')
      .map((keyword) => keyword.trim().toLowerCase())
      .filter(Boolean),
  )];
}
