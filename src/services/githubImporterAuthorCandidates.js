function candidateKey(author) {
  return [author.givenNames, author.familyNames].filter(Boolean).join(' ').toLowerCase();
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
  autoCreditLimit,
  normalizeAuthor,
}) {
  const sinceLabel = since ? since.split('T')[0] : '';
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
    const recentCommits = since ? (loginCounts.get(login.toLowerCase()) ?? 0) : null;
    const withinWindow = !since || recentCommits > 0;
    const autoSelected = withinWindow && credited < autoCreditLimit;
    if (autoSelected) {
      credited += 1;
    }

    const parts = [`GitHub contributor @${login}`, plural(contributions, 'commit')];
    if (since) {
      parts.push(recentCommits > 0
        ? `${recentCommits} since ${sinceLabel}`
        : `none found since ${sinceLabel} (may be inherited history)`);
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
