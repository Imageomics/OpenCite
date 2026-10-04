import { buildGithubCommitListApiUrl, buildGithubRequestConfig } from './githubApi.js';
import { dedupeAuthors } from './githubImporterAuthors.js';

const COMMIT_PAGE_SIZE = 100;
const UNAUTHENTICATED_PAGE_LIMIT = 1;
const AUTHENTICATED_PAGE_LIMIT = 10;

function isUsableCommitName(name, login, knownLogins) {
  const normalized = name.toLowerCase();
  if (!name || normalized === String(login ?? '').toLowerCase() || knownLogins.has(normalized)) {
    return false;
  }
  if (/\d/.test(name) || /^@/.test(name) || /\[bot\]|copilot|dependabot|chatgpt|openai|gemini|cursor|codex/i.test(name)) {
    return false;
  }
  if (name.includes('-') && !name.split('-').every((segment) => /^[A-Z][a-z]+$/.test(segment))) {
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
  const authorNames = [];
  let commits = Array.isArray(initialCommits) ? initialCommits : [];
  let page = 1;
  const maxPages = authToken ? AUTHENTICATED_PAGE_LIMIT : UNAUTHENTICATED_PAGE_LIMIT;

  while (true) {
    for (const commit of commits) {
      const name = cleanString(commit?.commit?.author?.name ?? '');
      const login = commit?.author?.login;
      if (commit?.author?.type && commit.author.type !== 'User') continue;
      if (isUsableCommitName(name, login, knownLogins)) authorNames.push(name);
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

  return dedupeAuthors(normalizeAuthors(authorNames.map((name) => normalizeAuthor({ name }))));
}