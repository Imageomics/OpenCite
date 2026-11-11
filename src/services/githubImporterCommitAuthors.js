import { buildGithubCommitListApiUrl, buildGithubRequestConfig } from './githubApi.js';
import { dedupeAuthors } from './githubImporterAuthors.js';
import { isAutomatedContributorIdentity } from './githubImporterContributors.js';

const COMMIT_PAGE_SIZE = 100;
const UNAUTHENTICATED_PAGE_LIMIT = 1;
const AUTHENTICATED_PAGE_LIMIT = 10;

function isUsableCommitName(name, login, knownLogins, cleanString) {
  const normalized = name.toLowerCase();
  if (!name || normalized === String(login ?? '').toLowerCase() || knownLogins.has(normalized)) {
    return false;
  }
  if (
    /\d/.test(name)
    || /[_@]/.test(name)
    || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)
    || isAutomatedContributorIdentity(name, cleanString)
    || isAutomatedContributorIdentity(login, cleanString)
  ) {
    return false;
  }
  if (!/\s/.test(name) && name.includes('-') && !name.split('-').every((segment) => /^[A-Z][a-z]+$/.test(segment))) {
    return false;
  }
  return true;
}

export async function fetchCommitAuthors({
  owner, repo, defaultBranch, initialCommits = [], knownGithubLogins = [],
  warnings, authToken = '', cleanString, normalizeAuthor, normalizeAuthors,
  addWarning, fetchOptionalJson,
}) {
  const knownLogins = new Set(knownGithubLogins.map((login) => cleanString(login).toLowerCase()));
  const discoveredAuthors = [];
  let commits = Array.isArray(initialCommits) ? initialCommits : [];
  let page = 1;
  const maxPages = authToken ? AUTHENTICATED_PAGE_LIMIT : UNAUTHENTICATED_PAGE_LIMIT;

  while (true) {
    for (const commit of commits) {
      const name = cleanString(commit?.commit?.author?.name ?? '');
      const login = cleanString(commit?.author?.login ?? '');
      if (login) knownLogins.add(login.toLowerCase());
      if (commit?.author?.type && commit.author.type !== 'User') continue;
      discoveredAuthors.push({ name, login });
    }

    if (commits.length < COMMIT_PAGE_SIZE) break;
    if (page >= maxPages) {
      addWarning(warnings, 'commit-authors', 'commit-author-scan-limited',
        `Scanned the first ${page * COMMIT_PAGE_SIZE} commits for contributor author names.`,
        { owner, repo, scannedPages: page, scannedCommits: page * COMMIT_PAGE_SIZE });
      break;
    }

    page += 1;
    commits = await fetchOptionalJson(
      buildGithubCommitListApiUrl(owner, repo, defaultBranch, COMMIT_PAGE_SIZE, page),
      buildGithubRequestConfig({
        authToken,
        source: 'commit-authors',
        label: `commit authors page ${page}`,
        onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
      }),
    ) || [];
    if (!Array.isArray(commits) || commits.length === 0) break;
  }

  const authorNames = discoveredAuthors
    .filter(({ name, login }) => isUsableCommitName(name, login, knownLogins, cleanString))
    .map(({ name }) => normalizeAuthor({ name }));
  return dedupeAuthors(normalizeAuthors(authorNames));
}