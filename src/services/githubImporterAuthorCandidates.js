import { authorsLikelyMatch } from './githubImporterAuthors.js';
import { normalizeOrcid } from '../utils/orcid.js';

function normalizedNameKey(author) {
  return [author.givenNames, author.familyNames].filter(Boolean).join(' ').toLowerCase();
}

function normalizedOrcid(author) {
  return normalizeOrcid(author?.orcid).toLowerCase();
}

function firstGivenName(author) {
  return String(author?.givenNames ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)[0] ?? '';
}

function firstGivenNamesMatch(author, candidate) {
  const authorFirst = firstGivenName(author);
  const candidateFirst = firstGivenName(candidate);
  return authorFirst === candidateFirst
    || (authorFirst.length === 1 && candidateFirst.startsWith(authorFirst))
    || (candidateFirst.length === 1 && authorFirst.startsWith(candidateFirst));
}

function authorNamesMatch(author, candidate) {
  return normalizedNameKey(author) === normalizedNameKey(candidate)
    || (firstGivenNamesMatch(author, candidate) && authorsLikelyMatch(author, candidate));
}

function candidateKey(author) {
  const name = normalizedNameKey(author);
  const orcid = normalizedOrcid(author);
  return orcid ? `${name}|orcid:${orcid}` : name;
}

// Uses the importer's fuzzy matcher so "Elizabeth G. Campolongo" counts as "Elizabeth Campolongo".
export function findMatchingAuthorIndex(authors, candidate, candidates = []) {
  const orcid = normalizedOrcid(candidate);
  if (orcid) {
    const orcidIndex = authors.findIndex((author) => normalizedOrcid(author) === orcid);
    if (orcidIndex !== -1) {
      return orcidIndex;
    }
  }

  const matchingIndexes = authors.flatMap((author, index) => {
    const authorOrcid = normalizedOrcid(author);
    if (authorOrcid && orcid && authorOrcid !== orcid) {
      return [];
    }
    if (!authorNamesMatch(author, candidate)) {
      return [];
    }

    const exactUnidentifiedMatch = !orcid
      && !authorOrcid
      && normalizedNameKey(author) === normalizedNameKey(candidate);
    const conflictingCandidate = !exactUnidentifiedMatch && candidates.some((other) => {
      if (other === candidate || (other.id && other.id === candidate.id)) {
        return false;
      }
      const otherOrcid = normalizedOrcid(other);
      return otherOrcid
        && otherOrcid !== orcid
        && otherOrcid !== authorOrcid
        && authorNamesMatch(author, other);
    });
    return conflictingCandidate ? [] : [index];
  });

  const identityPool = [...authors, ...candidates];
  const candidateFirst = firstGivenName(candidate);
  if (candidateFirst.length === 1) {
    const distinctFullFirstNames = new Set(
      identityPool
        .filter((other) => authorNamesMatch(other, candidate))
        .map(firstGivenName)
        .filter((name) => name.length > 1)
    );
    if (distinctFullFirstNames.size > 1) {
      return -1;
    }
  }

  const ambiguousInitialMatch = matchingIndexes.some((index) => {
    const author = authors[index];
    const matchingFullFirstNames = new Set(
      identityPool
        .filter((other) => authorNamesMatch(author, other))
        .map(firstGivenName)
        .filter((name) => name.length > 1)
    );
    return matchingFullFirstNames.size > 1;
  });
  if (ambiguousInitialMatch) {
    return -1;
  }

  const exactNameMatches = matchingIndexes.filter((index) => normalizedNameKey(authors[index]) === normalizedNameKey(candidate));
  if (exactNameMatches.length === 1) {
    return exactNameMatches[0];
  }

  const distinctOrcids = new Set(matchingIndexes.map((index) => normalizedOrcid(authors[index])).filter(Boolean));
  if (!orcid && distinctOrcids.size > 1) {
    return matchingIndexes.find((index) => !normalizedOrcid(authors[index])) ?? -1;
  }
  return matchingIndexes[0] ?? -1;
}

export function formatWindow(since, until) {
  const from = since ? since.split('T')[0] : '';
  const to = until ? until.split('T')[0] : '';
  if (from && to) {
    return `between ${from} and ${to}`;
  }
  return from ? `since ${from}` : `until ${to}`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Merges every GitHub-derived person into one reviewable candidate list and decides who is
 * credited automatically. Contributors are ranked by all-time contribution count, which is
 * only a hint; commit-history names are never credited automatically.
 */
export function buildAuthorCandidates({
  contributorCandidates = [],
  commitNames = [],
  coAuthorNames = [],
  loginCounts = new Map(),
  since = '',
  until = '',
  autoCreditLimit,
  normalizeAuthor,
}) {
  const windowLabel = formatWindow(since, until);
  const byKey = new Map();
  const byOrcid = new Map();

  function upsert(author, { source, reason, autoSelected = false, order, ...details }) {
    if (!author) {
      return;
    }

    const nameKey = normalizedNameKey(author);
    const orcidKey = normalizedOrcid(author);
    if (!nameKey) {
      return;
    }

    const sameNameCandidates = [...byKey.values()].filter((candidate) => authorNamesMatch(candidate, author));
    let existing = orcidKey ? byOrcid.get(orcidKey) : null;
    if (!existing && sameNameCandidates.length === 1) {
      const sameNameCandidate = sameNameCandidates[0];
      const existingOrcid = normalizedOrcid(sameNameCandidate);
      if (!orcidKey || !existingOrcid) {
        existing = sameNameCandidate;
      }
    }

    if (existing) {
      existing.order = Math.min(existing.order, order);
      existing.sources.push(source);
      existing.reasons.push(reason);
      existing.autoSelected = existing.autoSelected || autoSelected;
      existing.orcid ||= author.orcid;
      existing.affiliation ||= author.affiliation;
      Object.assign(existing, details);
      const updatedKey = candidateKey(existing);
      if (updatedKey !== existing.id) {
        byKey.delete(existing.id);
        existing.id = updatedKey;
        byKey.set(updatedKey, existing);
      }
      if (orcidKey) {
        byOrcid.set(orcidKey, existing);
      }
      return;
    }

    const baseKey = !orcidKey && sameNameCandidates.length > 1
      ? `${nameKey}|ambiguous:${sameNameCandidates.length + 1}`
      : candidateKey(author);
    let key = baseKey;
    let suffix = 2;
    while (byKey.has(key)) {
      key = `${baseKey}|${suffix}`;
      suffix += 1;
    }
    const candidate = {
      id: key,
      order,
      givenNames: author.givenNames,
      familyNames: author.familyNames,
      orcid: author.orcid,
      affiliation: author.affiliation,
      sources: [source],
      reasons: [reason],
      autoSelected,
      ...details,
    };
    byKey.set(key, candidate);
    if (orcidKey) {
      byOrcid.set(orcidKey, candidate);
    }
  }

  const records = coAuthorNames.map((name) => ({
    author: normalizeAuthor({ name }),
    source: 'co-author',
    reason: 'Named in a Co-authored-by trailer in recent commits',
    autoSelected: true,
  }));

  let credited = 0;
  for (const { author, login, contributions } of contributorCandidates) {
    const hasWindow = Boolean(since || until);
    const recentCommits = hasWindow ? (loginCounts.get(login.toLowerCase()) ?? 0) : null;
    const withinWindow = !hasWindow || recentCommits > 0;
    const autoSelected = withinWindow && credited < autoCreditLimit;
    if (autoSelected) {
      credited += 1;
    }

    const parts = [`GitHub contributor @${login}`, plural(contributions, 'commit')];
    if (hasWindow) {
      parts.push(recentCommits > 0
        ? `${recentCommits} ${windowLabel}`
        : `none found ${windowLabel} (may be outside the relevant history)`);
    }

    records.push({ author, source: 'github-contributor', reason: parts.join(' · '), autoSelected, login, contributions, recentCommits });
  }

  for (const { name, commits, lastCommitDate } of commitNames) {
    const last = lastCommitDate ? ` · last ${lastCommitDate.split('T')[0]}` : '';
    records.push({
      author: normalizeAuthor({ name }),
      source: 'commit-history',
      reason: `Commit author name · ${plural(commits, 'scanned commit')}${last}`,
      commitHistoryCommits: commits,
    });
  }

  records.forEach((record, order) => {
    record.order = order;
  });
  records.sort((left, right) => {
    const leftIsInitial = firstGivenName(left.author).length === 1;
    const rightIsInitial = firstGivenName(right.author).length === 1;
    return Number(leftIsInitial) - Number(rightIsInitial) || left.order - right.order;
  });
  for (const record of records) {
    const { author, ...details } = record;
    upsert(author, details);
  }

  return [...byKey.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ order, sources, reasons, ...candidate }) => ({
      ...candidate,
      sources,
      reason: reasons.join('; '),
    }));
}
