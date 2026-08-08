import {
  cleanString,
  normalizeAuthor,
  normalizeAuthors,
} from './githubImporterUtils.js';

function normalizeNameToken(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function authorMatchMetadata(author) {
  const givenNames = normalizeNameToken(author?.givenNames ?? '');
  const familyNames = normalizeNameToken(author?.familyNames ?? '');
  const givenTokens = givenNames.split(' ').filter(Boolean);
  const familyTokens = familyNames.split(' ').filter(Boolean);

  return {
    givenNames,
    familyNames,
    givenFirst: givenTokens[0] ?? '',
    givenInitials: givenTokens.map((token) => token[0]).join(''),
    familyLast: familyTokens[familyTokens.length - 1] ?? '',
    fullName: [givenNames, familyNames].filter(Boolean).join(' ').trim(),
  };
}

function authorAltNameKeys(author) {
  const metadata = authorMatchMetadata(author);
  const givenNames = metadata.givenNames;
  const familyNames = metadata.familyNames;
  const givenFirst = metadata.givenFirst;
  const familyLast = metadata.familyLast;
  const keys = new Set([
    `${givenNames}|${familyNames}`,
    `${givenFirst}|${familyNames}`,
    `${givenNames}|${familyLast}`,
    `${givenFirst}|${familyLast}`,
  ]);

  keys.delete('|');
  keys.delete('');
  return [...keys].filter(Boolean);
}

export function authorsLikelyMatch(sourceAuthor, contributorAuthor) {
  const source = authorMatchMetadata(sourceAuthor);
  const contributor = authorMatchMetadata(contributorAuthor);

  if (!source.familyLast || !contributor.familyLast || source.familyLast !== contributor.familyLast) {
    return false;
  }

  if (source.givenNames && contributor.givenNames && source.givenNames === contributor.givenNames) {
    return true;
  }

  if (source.givenFirst && contributor.givenFirst && source.givenFirst === contributor.givenFirst) {
    return true;
  }

  if (source.givenInitials && contributor.givenInitials && source.givenInitials === contributor.givenInitials) {
    return true;
  }

  if (source.fullName && contributor.fullName && source.fullName === contributor.fullName) {
    return true;
  }

  return false;
}

export function enrichAuthorsWithContributorData(sourceAuthors, contributorAuthors) {
  const normalizedSourceAuthors = normalizeAuthors(Array.isArray(sourceAuthors) ? sourceAuthors : []);
  if (normalizedSourceAuthors.length === 0) {
    return normalizeAuthors(Array.isArray(contributorAuthors) ? contributorAuthors : []);
  }

  const normalizedContributorAuthors = normalizeAuthors(Array.isArray(contributorAuthors) ? contributorAuthors : []);
  const contributorMatches = new Map();

  for (const contributorAuthor of normalizedContributorAuthors) {
    if (!contributorAuthor.orcid && !contributorAuthor.affiliation) {
      continue;
    }

    for (const key of authorAltNameKeys(contributorAuthor)) {
      const existing = contributorMatches.get(key) ?? [];
      existing.push(contributorAuthor);
      contributorMatches.set(key, existing);
    }
  }

  return normalizedSourceAuthors.map((author) => {
    const keyedMatches = authorAltNameKeys(author)
      .flatMap((key) => contributorMatches.get(key) ?? []);
    const heuristicMatches = normalizedContributorAuthors.filter((contributorAuthor) => authorsLikelyMatch(author, contributorAuthor));
    const matches = [...new Set([...keyedMatches, ...heuristicMatches])];
    const uniqueOrcids = [...new Set(matches.map((match) => match.orcid).filter(Boolean))];
    const uniqueAffiliations = [...new Set(matches.map((match) => match.affiliation).filter(Boolean))];

    if ((!author.orcid && uniqueOrcids.length > 1) || (!author.affiliation && uniqueAffiliations.length > 1)) {
      return author;
    }

    return {
      ...author,
      orcid: author.orcid || uniqueOrcids[0] || '',
      affiliation: author.affiliation || uniqueAffiliations[0] || '',
    };
  });
}

export function dedupeAuthors(authors) {
  const seen = new Set();
  const byOrcid = new Map();
  const byName = new Map();
  const deduped = [];

  for (const rawAuthor of authors) {
    const author = normalizeAuthor(rawAuthor);
    if (!author) {
      continue;
    }

    const orcidKey = cleanString(author?.orcid ?? '').toLowerCase();
    const nameKey = [
      cleanString(author?.givenNames ?? '').toLowerCase(),
      cleanString(author?.familyNames ?? '').toLowerCase(),
    ].join('|');

    if (nameKey !== '|' && byName.has(nameKey)) {
      const existing = byName.get(nameKey);
      const existingOrcid = cleanString(existing?.orcid ?? '').toLowerCase();
      const canMergeByName = !existingOrcid || !orcidKey || existingOrcid === orcidKey;

      if (canMergeByName) {
        if (!existing.orcid && author.orcid) {
          existing.orcid = author.orcid;
        }
        if (!existing.affiliation && author.affiliation) {
          existing.affiliation = author.affiliation;
        }
        if (orcidKey && !byOrcid.has(orcidKey)) {
          byOrcid.set(orcidKey, existing);
        }
        continue;
      }
    }

    const likelyMatch = deduped.find((existing) => {
      const existingOrcid = cleanString(existing?.orcid ?? '').toLowerCase();
      const hasConflictingOrcid = existingOrcid && orcidKey && existingOrcid !== orcidKey;

      if (hasConflictingOrcid) {
        return false;
      }

      return authorsLikelyMatch(existing, author);
    });

    if (likelyMatch) {
      if (!likelyMatch.orcid && author.orcid) {
        likelyMatch.orcid = author.orcid;
      }
      if (!likelyMatch.affiliation && author.affiliation) {
        likelyMatch.affiliation = author.affiliation;
      }

      const mergedOrcidKey = cleanString(likelyMatch?.orcid ?? '').toLowerCase();
      if (mergedOrcidKey && !byOrcid.has(mergedOrcidKey)) {
        byOrcid.set(mergedOrcidKey, likelyMatch);
      }
      continue;
    }

    if (orcidKey && byOrcid.has(orcidKey)) {
      const existing = byOrcid.get(orcidKey);
      if (!existing.affiliation && author.affiliation) {
        existing.affiliation = author.affiliation;
      }
      continue;
    }

    const key = [
      cleanString(author?.givenNames ?? '').toLowerCase(),
      cleanString(author?.familyNames ?? '').toLowerCase(),
      cleanString(author?.orcid ?? '').toLowerCase(),
    ].join('|');

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    const normalizedAuthor = { ...author };
    deduped.push(normalizedAuthor);

    if (orcidKey) {
      byOrcid.set(orcidKey, normalizedAuthor);
    }

    if (nameKey !== '|') {
      byName.set(nameKey, normalizedAuthor);
    }
  }

  return deduped;
}

export function orderAuthorsByContributorRank(authors, contributorAuthors) {
  const normalizedAuthors = normalizeAuthors(Array.isArray(authors) ? authors : []);
  const normalizedContributors = normalizeAuthors(Array.isArray(contributorAuthors) ? contributorAuthors : []);

  if (normalizedContributors.length === 0 || normalizedAuthors.length <= 1) {
    return normalizedAuthors;
  }

  const contributorOrcidIndex = new Map();
  const contributorNameKeyIndex = new Map();

  normalizedContributors.forEach((contributorAuthor, index) => {
    const orcidKey = cleanString(contributorAuthor?.orcid ?? '').toLowerCase();
    if (orcidKey && !contributorOrcidIndex.has(orcidKey)) {
      contributorOrcidIndex.set(orcidKey, index);
    }

    for (const key of authorAltNameKeys(contributorAuthor)) {
      if (!contributorNameKeyIndex.has(key)) {
        contributorNameKeyIndex.set(key, index);
      }
    }
  });

  const ranked = normalizedAuthors.map((author, originalIndex) => {
    const orcidKey = cleanString(author?.orcid ?? '').toLowerCase();
    if (orcidKey && contributorOrcidIndex.has(orcidKey)) {
      return { author, originalIndex, rank: contributorOrcidIndex.get(orcidKey) };
    }

    const nameRanks = authorAltNameKeys(author)
      .map((key) => contributorNameKeyIndex.get(key))
      .filter((value) => Number.isInteger(value));

    if (nameRanks.length > 0) {
      return { author, originalIndex, rank: Math.min(...nameRanks) };
    }

    const heuristicIndex = normalizedContributors.findIndex((contributorAuthor) => authorsLikelyMatch(author, contributorAuthor));
    if (heuristicIndex >= 0) {
      return { author, originalIndex, rank: heuristicIndex };
    }

    return { author, originalIndex, rank: Number.POSITIVE_INFINITY };
  });

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }

    return left.originalIndex - right.originalIndex;
  });

  return ranked.map((entry) => entry.author);
}
