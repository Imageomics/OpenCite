const ZENODO_RECORDS_API = 'https://zenodo.org/api/records';

function cleanString(value) {
  return String(value ?? '').trim();
}

function normalizeUrl(value) {
  return cleanString(value)
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function recordDoi(record) {
  return cleanString(record?.doi ?? record?.metadata?.doi ?? '');
}

function recordReferencesRepository(record, repositoryUrl) {
  const normalizedRepositoryUrl = normalizeUrl(repositoryUrl);
  if (!normalizedRepositoryUrl) {
    return false;
  }

  const relatedIdentifiers = Array.isArray(record?.metadata?.related_identifiers)
    ? record.metadata.related_identifiers
    : [];
  const relatedUrls = relatedIdentifiers.map((identifier) => identifier?.identifier);
  const recordUrls = [
    record?.metadata?.url,
    record?.links?.html,
    ...relatedUrls,
  ];

  return recordUrls.some((url) => normalizeUrl(url) === normalizedRepositoryUrl);
}

export async function lookupZenodoDoi({ repositoryUrl, title, fetchImpl = globalThis.fetch } = {}) {
  const normalizedTitle = cleanString(title);
  if (!normalizedTitle || typeof fetchImpl !== 'function') {
    return null;
  }

  const query = `metadata.title:"${normalizedTitle.replace(/"/g, '\\"')}"`;
  const url = `${ZENODO_RECORDS_API}?q=${encodeURIComponent(query)}&all_versions=true&size=20`;

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    return null;
  }

  if (!response?.ok) {
    return null;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const hits = Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
  const exactTitleHits = hits.filter((record) => cleanString(record?.metadata?.title).toLowerCase() === normalizedTitle.toLowerCase());
  const repositoryMatch = exactTitleHits.find((record) => recordReferencesRepository(record, repositoryUrl));
  const selectedRecord = repositoryMatch || (exactTitleHits.length === 1 ? exactTitleHits[0] : null);
  const doi = recordDoi(selectedRecord);

  return doi || null;
}