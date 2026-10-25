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

/**
 * Scans a bounded window of commit history. Returns usable human author names (with commit
 * counts and last-seen dates) plus per-login commit counts, so callers can tell who was
 * active inside an optional `since`/`until` window.
 */
export async function scanCommitHistory({
  owner, repo, defaultBranch, initialCommits = [], knownGithubLogins = [], since = '', until = '',
  warnings, authToken = '', cleanString, addWarning, fetchOptionalJson,
}) {
  const knownLogins = new Set(knownGithubLogins.map((login) => cleanString(login).toLowerCase()));
  const names = new Map();
  const loginCounts = new Map();
  const maxPages = authToken ? AUTHENTICATED_PAGE_LIMIT : UNAUTHENTICATED_PAGE_LIMIT;
  // Initial commits come from an unfiltered request, so a date range needs its own first page.
  let commits = (since || until) ? null : (Array.isArray(initialCommits) ? initialCommits : []);
  let page = 1;

  const fetchPage = async (pageNumber) => {
    const result = await fetchOptionalJson(
      buildGithubCommitListApiUrl(owner, repo, defaultBranch, COMMIT_PAGE_SIZE, pageNumber, since, until),
      buildGithubRequestConfig({
        authToken,
        source: 'commit-authors',
        label: `commit authors page ${pageNumber}`,
        onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
      }),
    );
    return Array.isArray(result) ? result : [];
  };

  if (commits === null) {
    commits = await fetchPage(1);
  }

  while (true) {
    for (const commit of commits) {
      const name = cleanString(commit?.commit?.author?.name ?? '');
      const login = cleanString(commit?.author?.login ?? '');
      const date = cleanString(commit?.commit?.author?.date ?? '');
      if (commit?.author?.type && commit.author.type !== 'User') continue;
      if (login) {
        loginCounts.set(login.toLowerCase(), (loginCounts.get(login.toLowerCase()) ?? 0) + 1);
      }
      if (isUsableCommitName(name, login, knownLogins)) {
        const entry = names.get(name) ?? { name, login, commits: 0, lastCommitDate: '' };
        entry.commits += 1;
        if (date > entry.lastCommitDate) entry.lastCommitDate = date;
        names.set(name, entry);
      }
    }

    if (commits.length < COMMIT_PAGE_SIZE) break;
    if (page >= maxPages) {
      addWarning(warnings, 'commit-authors', 'commit-author-scan-limited',
        `Scanned the first ${page * COMMIT_PAGE_SIZE} commits for contributor author names.`,
        { owner, repo, scannedPages: page, scannedCommits: page * COMMIT_PAGE_SIZE });
      break;
    }

    page += 1;
    commits = await fetchPage(page);
    if (commits.length === 0) break;
  }

  return { names: [...names.values()], loginCounts };
}

export async function fetchCommitAuthors({ normalizeAuthor, normalizeAuthors, ...scanOptions }) {
  const { names } = await scanCommitHistory(scanOptions);
  return dedupeAuthors(normalizeAuthors(names.map(({ name }) => normalizeAuthor({ name }))));
}