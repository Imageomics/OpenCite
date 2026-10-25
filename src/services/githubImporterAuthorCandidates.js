import { authorsLikelyMatch } from './githubImporterAuthors.js';

function candidateKey(author) {
  return [author.givenNames, author.familyNames].filter(Boolean).join(' ').toLowerCase();
}

// Uses the importer's fuzzy matcher so "Elizabeth G. Campolongo" counts as "Elizabeth Campolongo".
export function findMatchingAuthorIndex(authors, candidate) {
  return authors.findIndex((author) => candidateKey(author) === candidate.id || authorsLikelyMatch(author, candidate));
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

  function upsert(author, { source, reason, autoSelected = false, ...details }) {
    if (!author) {
      return;
    }

    const key = candidateKey(author);
    if (!key) {
      return;
    }

    const existing = byKey.get(key);
    if (existing) {
      existing.sources.push(source);
      existing.reasons.push(reason);
      existing.autoSelected = existing.autoSelected || autoSelected;
      existing.orcid ||= author.orcid;
      existing.affiliation ||= author.affiliation;
      Object.assign(existing, details);
      return;
    }

    byKey.set(key, {
      id: key,
      givenNames: author.givenNames,
      familyNames: author.familyNames,
      orcid: author.orcid,
      affiliation: author.affiliation,
      sources: [source],
      reasons: [reason],
      autoSelected,
      ...details,
    });
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
