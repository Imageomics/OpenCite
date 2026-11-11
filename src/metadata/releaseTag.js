function normalizeReleaseIdentifier(value) {
  return String(value ?? '').trim().replace(/^v/i, '');
}

export function getDefaultReleaseTag(version) {
  const normalizedVersion = normalizeReleaseIdentifier(version);
  return normalizedVersion ? `v${normalizedVersion}` : '';
}

export function releaseTagMatchesVersion(version, releaseTag) {
  const normalizedVersion = normalizeReleaseIdentifier(version);
  const normalizedTag = normalizeReleaseIdentifier(releaseTag);
  return Boolean(normalizedVersion && normalizedTag && normalizedVersion === normalizedTag);
}
