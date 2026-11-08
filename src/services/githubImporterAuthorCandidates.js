import { authorsLikelyMatch } from './githubImporterAuthors.js';

function normalizedNameKey(author) {
  return [author.givenNames, author.familyNames].filter(Boolean).join(' ').toLowerCase();
}

function normalizedOrcid(author) {
  return String(author?.orcid ?? '').trim().toLowerCase();
}

function firstGivenName(author) {
  return String(author?.givenNames ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)[0] ?? '';
}

function candidateKey(author) {
  const name = normalizedNameKey(author);
  const orcid = normalizedOrcid(author);
  return orcid ? `${name}|orcid:${orcid}` : name;
}

// Uses the importer's fuzzy matcher so "Elizabeth G. Campolongo" counts as "Elizabeth Campolongo".
export function findMatchingAuthorIndex(authors, candidate) {
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
    const exactNameMatch = normalizedNameKey(author) === normalizedNameKey(candidate);
    const fuzzyNameMatch = firstGivenName(author) === firstGivenName(candidate)
      && authorsLikelyMatch(author, candidate);
    return exactNameMatch || fuzzyNameMatch
      ? [index]
      : [];
  });

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
  const byName = new Map();
  const byOrcid = new Map();

  function upsert(author, { source, reason, autoSelected = false, ...details }) {
    if (!author) {
      return;
    }

    const nameKey = normalizedNameKey(author);
    const orcidKey = normalizedOrcid(author);
    if (!nameKey) {
      return;
    }

    const sameNameCandidates = byName.get(nameKey) ?? [];
    let existing = orcidKey ? byOrcid.get(orcidKey) : null;
    if (!existing && sameNameCandidates.length === 1) {
      const sameNameCandidate = sameNameCandidates[0];
      const existingOrcid = normalizedOrcid(sameNameCandidate);
      if (!orcidKey || !existingOrcid) {
        existing = sameNameCandidate;
      }
    } else if (!existing && !orcidKey && sameNameCandidates.length === 0) {
      existing = null;
    }

    if (existing) {
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

    const key = !orcidKey && sameNameCandidates.length > 1
      ? `${nameKey}|ambiguous:${sameNameCandidates.length + 1}`
      : candidateKey(author);
    const candidate = {
      id: key,
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
    byName.set(nameKey, [...sameNameCandidates, candidate]);
    if (orcidKey) {
      byOrcid.set(orcidKey, candidate);
    }
  }

  for (const name of coAuthorNames) {
    upsert(normalizeAuthor({ name }), {
      source: 'co-author',
      reason: 'Named in a Co-authored-by trailer in recent commits',
      autoSelected: true,
    });
  }

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

    upsert(author, { source: 'github-contributor', reason: parts.join(' · '), autoSelected, login, contributions, recentCommits });
  }

  for (const { name, commits, lastCommitDate } of commitNames) {
    const last = lastCommitDate ? ` · last ${lastCommitDate.split('T')[0]}` : '';
    upsert(normalizeAuthor({ name }), {
      source: 'commit-history',
      reason: `Commit author name · ${plural(commits, 'scanned commit')}${last}`,
      commitHistoryCommits: commits,
    });
  }

  return [...byKey.values()].map(({ sources, reasons, ...candidate }) => ({
    ...candidate,
    sources,
    reason: reasons.join('; '),
  }));
}
