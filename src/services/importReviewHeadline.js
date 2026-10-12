export function importReviewHeadline(importStatus, findingCount) {
  if (findingCount > 0) return `Review findings (${findingCount})`;
  if (importStatus.errors.length > 0) return `Import errors (${importStatus.errors.length})`;
  if (importStatus.warnings.length > 0) return `Import warnings (${importStatus.warnings.length})`;
  return 'No health or comparison findings';
}