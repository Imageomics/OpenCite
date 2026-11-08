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
    affiliations,
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
  const affiliations = [];
  const groups = String(value ?? '').split(/[;|]/);
  const institutionPattern = /\b(university|college|institute|center|centre|school|laboratory|lab)\b/i;

  for (const group of groups) {
    const parts = group.split(',');
    let current = parts[0] ?? '';

    for (const part of parts.slice(1)) {
      const next = part.trim();
      const nextHasInstitutionName = institutionPattern.test(next);

      if (current.trim().startsWith('@') || next.startsWith('@') || !institutionPattern.test(current) || nextHasInstitutionName) {
        affiliations.push(current);
        current = part;
      } else {
        current += `,${part}`;
      }
    }

    affiliations.push(current);
  }

  return affiliations.map((part) => part.trim()).filter(Boolean);
}

const genericAffiliationWords = new Set([
  'association',
  'center',
  'centre',
  'college',
  'department',
  'institute',
  'laboratory',
  'lab',
  'organization',
  'organisation',
  'school',
  'university',
]);

function affiliationNamesMatch(company, institution, allowTokenMatch) {
  if (!company || !institution) {
    return false;
  }

  if (company === institution) {
    return true;
  }

  const shorter = company.length < institution.length ? company : institution;
  const longer = company.length < institution.length ? institution : company;
  const shorterWords = shorter.split(' ');
  const longerWords = longer.split(' ');

  if (allowTokenMatch && shorterWords.length === 1 && shorterWords[0].length >= 5 && !genericAffiliationWords.has(shorterWords[0])) {
    return longerWords.includes(shorterWords[0]);
  }

  const startsWithShorter = longer.startsWith(`${shorter} `);
  const endsWithShorter = longer.endsWith(` ${shorter}`);
  const extraWords = startsWithShorter
    ? longerWords.slice(shorterWords.length)
    : longerWords.slice(0, longerWords.length - shorterWords.length);

  return (startsWithShorter || endsWithShorter)
    && extraWords.length > 0
    && extraWords.every((word) => genericAffiliationWords.has(word));
}

export function affiliationLooksSimilar(companyValues, institution) {
  const companies = splitAffiliations(companyValues);
  const normalizedInstitution = normalizeName(institution);
  if (!normalizedInstitution) {
    return false;
  }

  return companies.some((company) => {
    const normalizedCompany = normalizeName(company);
    if (!normalizedCompany) {
      return false;
    }
    return affiliationNamesMatch(normalizedCompany, normalizedInstitution, !company.includes(','));
  });
}

function getCandidateAffiliations(candidate) {
  if (Array.isArray(candidate?.affiliations) && candidate.affiliations.length > 0) {
    return candidate.affiliations;
  }

  return candidate?.affiliation ? [candidate.affiliation] : [];
}

function rankCandidates(candidates, author) {
  const given = normalizeName(author?.givenNames);
  const family = normalizeName(author?.familyNames);
  const affiliation = String(author?.affiliation ?? '').trim();

  return candidates
    .map((candidate, index) => {
      const exactNameMatch = normalizeName(candidate.givenNames) === given
        && normalizeName(candidate.familyNames) === family;
      const affiliationMatch = Boolean(affiliation) && getCandidateAffiliations(candidate)
        .some((candidateAffiliation) => affiliationLooksSimilar(affiliation, candidateAffiliation));
      return { candidate, index, exactNameMatch, affiliationMatch };
    })
    .sort((left, right) => {
      if (left.exactNameMatch !== right.exactNameMatch) {
        return left.exactNameMatch ? -1 : 1;
      }
      if (left.affiliationMatch !== right.affiliationMatch) {
        return left.affiliationMatch ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ candidate }) => candidate);
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
    const exactWithAffiliation = exactNameMatches.filter((candidate) => {
      return getCandidateAffiliations(candidate)
        .some((candidateAffiliation) => affiliationLooksSimilar(affiliation, candidateAffiliation));
    });
    if (exactWithAffiliation.length === 1) {
      return exactWithAffiliation[0];
    }
  }

  return null;
}

export async function searchOrcidCandidates(author, { signal } = {}) {
  const query = buildOrcidQuery(author);
  if (!query) {
    return [];
  }

  const response = await fetch(`https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(query)}&rows=20`, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`ORCID search failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const results = Array.isArray(payload?.['expanded-result']) ? payload['expanded-result'] : [];

  const candidates = results.map((result) => normalizeCandidate(result)).filter(Boolean);

  return rankCandidates(candidates, author).slice(0, 5);
}

export function createOrcidLookupController() {
  let enabled = true;
  let generation = 0;
  const pending = new Set();

  return {
    get enabled() {
      return enabled;
    },
    get generation() {
      return generation;
    },
    setEnabled(value) {
      if (enabled === value) {
        return;
      }

      enabled = value;
      generation += 1;
      if (!enabled) {
        for (const controller of pending) {
          controller.abort();
        }
      }
    },
    async search(author) {
      if (!enabled) {
        throw new Error('ORCID lookup is disabled.');
      }

      const controller = new AbortController();
      pending.add(controller);
      try {
        return await searchOrcidCandidates(author, { signal: controller.signal });
      } finally {
        pending.delete(controller);
      }
    },
  };
}