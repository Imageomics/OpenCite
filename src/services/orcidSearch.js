function quoteQueryValue(value) {
  return `"${String(value ?? '').replace(/"/g, '\\"').trim()}"`;
}

// Affiliation is intentionally not part of the query: GitHub "Company" values
// (e.g. "@Imageomics, @ABC") rarely match ORCID org names, and requiring a
// match hides valid results. It is only used to rank and disambiguate.
export function buildOrcidQuery({ givenNames, familyNames }) {
  const parts = [];
  const given = String(givenNames ?? '').trim();
  const family = String(familyNames ?? '').trim();

  if (given) {
    parts.push(`given-names:${quoteQueryValue(given)}`);
  }

  if (family) {
    parts.push(`family-name:${quoteQueryValue(family)}`);
  }

  return parts.join(' AND ');
}

function normalizeCandidate(result) {
  const orcidId = String(result?.['orcid-id'] ?? '').trim();
  if (!orcidId) {
    return null;
  }

  const givenNames = String(result?.['given-names'] ?? '').trim();
  const familyNames = String(result?.['family-names'] ?? '').trim();
  const affiliations = [];

  for (const key of ['institution-name', 'employment-org-name', 'ror-org-name']) {
    const rawValue = result?.[key];
    if (Array.isArray(rawValue)) {
      affiliations.push(...rawValue.map((item) => String(item ?? '').trim()).filter(Boolean));
    } else if (rawValue) {
      affiliations.push(String(rawValue).trim());
    }
  }

  return {
    orcid: `https://orcid.org/${orcidId}`,
    givenNames,
    familyNames,
    affiliation: affiliations[0] ?? '',
    label: [givenNames, familyNames].filter(Boolean).join(' ').trim() || orcidId,
  };
}

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitAffiliations(value) {
  return String(value ?? '')
    .split(/[,;|]/)
    .map((part) => normalizeName(part))
    .filter(Boolean);
}

export function affiliationLooksSimilar(left, right) {
  const lefts = splitAffiliations(left);
  const rights = splitAffiliations(right);

  return lefts.some((a) => rights.some((b) => a === b || a.includes(b) || b.includes(a)));
}

function rankByAffiliation(candidates, affiliation) {
  if (!String(affiliation ?? '').trim()) {
    return candidates;
  }

  const matching = candidates.filter((candidate) => affiliationLooksSimilar(candidate.affiliation, affiliation));
  return [...matching, ...candidates.filter((candidate) => !matching.includes(candidate))];
}

export function pickPreferredOrcidCandidate(author, candidates) {
  const given = normalizeName(author?.givenNames);
  const family = normalizeName(author?.familyNames);
  const affiliation = String(author?.affiliation ?? '').trim();
  const exactNameMatches = candidates.filter((candidate) => {
    return normalizeName(candidate.givenNames) === given && normalizeName(candidate.familyNames) === family;
  });

  if (exactNameMatches.length === 1) {
    return exactNameMatches[0];
  }

  if (exactNameMatches.length > 1 && affiliation) {
    const exactWithAffiliation = exactNameMatches.filter((candidate) => affiliationLooksSimilar(candidate.affiliation, affiliation));
    if (exactWithAffiliation.length === 1) {
      return exactWithAffiliation[0];
    }
  }

  return null;
}

export async function searchOrcidCandidates(author) {
  const query = buildOrcidQuery(author);
  if (!query) {
    return [];
  }

  const response = await fetch(`https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(query)}&rows=20`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`ORCID search failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const results = Array.isArray(payload?.['expanded-result']) ? payload['expanded-result'] : [];

  const candidates = results.map((result) => normalizeCandidate(result)).filter(Boolean);

  return rankByAffiliation(candidates, author?.affiliation).slice(0, 5);
}