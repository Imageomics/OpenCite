import {
  buildGithubCommitListApiUrl,
  buildGithubContributorsApiUrl,
  buildGithubRequestConfig,
  buildGithubUserApiUrl,
  buildGithubUserSocialAccountsApiUrl,
} from './githubApi.js';
import { dedupeAuthors } from './githubImporterAuthors.js';

const GITHUB_PAGE_SIZE = 100;
const GITHUB_COMMIT_PAGE_SIZE = 100;
const UNAUTHENTICATED_COMMIT_SCAN_PAGE_LIMIT = 1;
const AUTHENTICATED_COMMIT_SCAN_PAGE_LIMIT = 10;
const DEFAULT_CONTRIBUTOR_FALLBACK_LIMIT = 50;

function isAutomatedContributorIdentity(value, cleanString) {
  const text = cleanString(value ?? '').trim();
  if (!text) {
    return false;
  }

  const normalized = text.toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }

  if (normalized.includes('copilot') || normalized.includes('gemini') || normalized.includes('chatgpt') || normalized.includes('openai') || normalized.includes('cursor')) {
    return true;
  }

  if (normalized.includes('[bot]') || normalized.endsWith('-bot') || normalized.startsWith('bot-') || normalized.includes('-bot')) {
    return true;
  }

  // 'claude' is intentionally excluded here: it's a real human first name, so a bare
  // single-token identity of "claude" should not be treated as the AI assistant.
  // Actual Claude-related bot accounts still match via the multi-token phrase checks below.
  const singleTokenAutomation = new Set([
    'copilot',
    'codex',
    'dependabot',
    'chatgpt',
    'gpt',
    'openai',
    'gemini',
    'cursor',
    'assistant',
    'bot',
  ]);

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return singleTokenAutomation.has(tokens[0]);
  }

  const [first, second] = tokens;
  const secondTokenIsAutomationKeyword = Boolean(second) && [
    'actions',
    'copilot',
    'agent',
    'code',
    'cli',
    'bot',
    'assistant',
  ].includes(second);

  if (first === 'github' && secondTokenIsAutomationKeyword) {
    return true;
  }

  if ((first === 'claude' || first === 'copilot' || first === 'gemini' || first === 'cursor' || first === 'swe') && secondTokenIsAutomationKeyword) {
    return true;
  }

  if (first === 'claude' && second === 'fable') {
    return true;
  }

  const combinedPhrase = normalized.replace(/-/g, ' ');
  return [
    'github actions',
    'github copilot',
    'copilot agent',
    'swe agent',
    'claude code',
    'claude agent',
    'claude bot',
    'claude cli',
    'codex',
    'dependabot',
    'chatgpt',
    'openai',
    'gemini code',
    'gemini agent',
    'gemini cli',
    'cursor agent',
    'cursor cli',
    'ai assistant',
  ].some((phrase) => combinedPhrase.includes(phrase));
}

function isLikelyGithubUsername(value, cleanString) {
  const text = cleanString(value ?? '').trim();
  if (!text) {
    return false;
  }

  if (text.startsWith('@')) {
    return true;
  }

  if (/\s/.test(text)) {
    return false;
  }

  return /\d/.test(text) || /[._-]/.test(text) || /[a-z][A-Z]/.test(text);
}

function matchesGithubLoginName(name, login, cleanString) {
  const normalizedName = cleanString(name ?? '').toLowerCase();
  const normalizedLogin = cleanString(login ?? '').toLowerCase();
  return Boolean(normalizedName && normalizedLogin && normalizedName === normalizedLogin);
}

function isAutomatedContributor(contributor, profile, cleanString) {
  const login = cleanString(profile?.login ?? contributor?.login ?? '').toLowerCase();
  const contributorType = cleanString(contributor?.type ?? '').toLowerCase();
  const profileType = cleanString(profile?.type ?? '').toLowerCase();
  const profileName = cleanString(profile?.name ?? '').toLowerCase();

  if ((contributorType && contributorType !== 'user') || (profileType && profileType !== 'user')) {
    return true;
  }

  if (isAutomatedContributorIdentity(login, cleanString)) {
    return true;
  }

  if (isAutomatedContributorIdentity(profileName, cleanString)) {
    return true;
  }

  return false;
}

async function fetchAllContributors(owner, repo, warnings, authToken, maxContributors, { fetchOptionalJson, addWarning }) {
  const contributors = [];
  let page = 1;
  const sortByContributionCount = (left, right) => {
    const leftContributions = Number(left?.contributions);
    const rightContributions = Number(right?.contributions);
    const leftHasCount = Number.isFinite(leftContributions);
    const rightHasCount = Number.isFinite(rightContributions);

    if (leftHasCount && rightHasCount && leftContributions !== rightContributions) {
      return rightContributions - leftContributions;
    }

    if (leftHasCount !== rightHasCount) {
      return leftHasCount ? -1 : 1;
    }

    return 0;
  };

  while (true) {
    const pageContributors = await fetchOptionalJson(
      buildGithubContributorsApiUrl(owner, repo, page, GITHUB_PAGE_SIZE),
      buildGithubRequestConfig({
        authToken,
        source: 'contributors',
        label: `contributors page ${page}`,
        onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
      }),
    ) || [];

    if (!Array.isArray(pageContributors) || pageContributors.length === 0) {
      break;
    }

    const eligiblePageContributors = pageContributors.filter((contributor) => {
      const login = String(contributor?.login ?? '').trim();
      return !login || !isAutomatedContributor(contributor, null, (value) => String(value ?? ''));
    });
    const excludedAutomatedCount = pageContributors.length - eligiblePageContributors.length;
    if (excludedAutomatedCount > 0) {
      addWarning(
        warnings,
        'authors',
        'automated-contributors-excluded',
        `Excluded ${excludedAutomatedCount} automated account(s) from fallback authors.`,
        { owner, repo },
      );
    }
    contributors.push(...eligiblePageContributors);

    if (maxContributors !== null && contributors.length >= maxContributors) {
      return contributors.sort(sortByContributionCount).slice(0, maxContributors);
    }

    if (pageContributors.length < GITHUB_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return contributors.sort(sortByContributionCount);
}

export function resolveContributorFallbackLimit(options = {}) {
  const rawLimit = options?.contributorFallbackLimit;
  if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
    return DEFAULT_CONTRIBUTOR_FALLBACK_LIMIT;
  }

  const limit = Number(rawLimit);
  return Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : DEFAULT_CONTRIBUTOR_FALLBACK_LIMIT;
}

export function extractCoAuthorNamesFromCommitMessage(message, knownGithubLogins = []) {
  const names = new Set();
  const normalizedGithubLogins = new Set(
    knownGithubLogins
      .map((login) => String(login ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  const text = String(message ?? '');

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/^[Cc]o-authored-by:/i.test(trimmed)) {
      continue;
    }

    const rawName = trimmed
      .replace(/^[Cc]o-authored-by:\s*/i, '')
      .replace(/\s*<[^>]+>\s*$/, '')
      .trim();

    if (!rawName
      || normalizedGithubLogins.has(rawName.toLowerCase())
      || isLikelyGithubUsername(rawName, (value) => String(value ?? ''))
      || isAutomatedContributorIdentity(rawName, (value) => String(value ?? ''))) {
      continue;
    }

    names.add(rawName);
  }

  return [...names];
}

export async function fetchCommitAuthors({
  owner,
  repo,
  defaultBranch,
  initialCommits = [],
  knownGithubLogins = [],
  warnings,
  authToken = '',
  cleanString,
  normalizeAuthor,
  normalizeAuthors,
  addWarning,
  fetchOptionalJson,
  maxPages = authToken ? AUTHENTICATED_COMMIT_SCAN_PAGE_LIMIT : UNAUTHENTICATED_COMMIT_SCAN_PAGE_LIMIT,
}) {
  const authorNames = [];
  const normalizedGithubLogins = new Set(
    knownGithubLogins
      .map((login) => cleanString(login).toLowerCase())
      .filter(Boolean),
  );
  let commits = Array.isArray(initialCommits) ? initialCommits : [];
  let page = 1;

  while (true) {
    for (const commit of commits) {
      const name = cleanString(commit?.commit?.author?.name ?? '');
      if (!name
        || matchesGithubLoginName(name, commit?.author?.login, cleanString)
        || normalizedGithubLogins.has(name.toLowerCase())
        || isLikelyGithubUsername(name, cleanString)
        || isAutomatedContributor(commit?.author, null, cleanString)
        || isAutomatedContributorIdentity(name, cleanString)) {
        continue;
      }

      authorNames.push(name);
    }

    if (commits.length < GITHUB_COMMIT_PAGE_SIZE) {
      break;
    }

    if (maxPages && page >= maxPages) {
      addWarning(
        warnings,
        'commit-authors',
        'commit-author-scan-limited',
        `Scanned the first ${page * GITHUB_COMMIT_PAGE_SIZE} commits for contributor author names.`,
        { owner, repo, scannedPages: page, scannedCommits: page * GITHUB_COMMIT_PAGE_SIZE },
      );
      break;
    }

    page += 1;
    commits = await fetchOptionalJson(
      buildGithubCommitListApiUrl(owner, repo, defaultBranch, GITHUB_COMMIT_PAGE_SIZE, page),
      buildGithubRequestConfig({
        authToken,
        source: 'commit-authors',
        label: `commit authors page ${page}`,
        onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
      }),
    ) || [];

    if (!Array.isArray(commits) || commits.length === 0) {
      break;
    }
  }

  return dedupeAuthors(normalizeAuthors(authorNames.map((name) => normalizeAuthor({ name }))));
}

export async function fetchContributorAuthors({
  owner,
  repo,
  warnings,
  authToken = '',
  contributorFallbackLimit = DEFAULT_CONTRIBUTOR_FALLBACK_LIMIT,
  emitFallbackWarning = true,
  cleanString,
  normalizeAuthor,
  normalizeAuthors,
  addWarning,
  fetchOptionalJson,
  extractOrcidFromGithubProfile,
}) {
  const contributors = await fetchAllContributors(owner, repo, warnings, authToken, contributorFallbackLimit, {
    fetchOptionalJson,
    addWarning,
  });

  if (!Array.isArray(contributors) || contributors.length === 0) {
    return {
      fallbackAuthors: [],
      lookupAuthors: [],
      githubLogins: [],
    };
  }

  if (emitFallbackWarning) {
    addWarning(
      warnings,
      'authors',
      'commit-based-fallback',
      contributorFallbackLimit
        ? `Using top ${contributorFallbackLimit} contributors as fallback authors.`
        : 'Using contributors as fallback authors.',
      { owner, repo },
    );
  }

  const profiles = await Promise.all(
    contributors.map(async (contributor) => {
      const login = cleanString(contributor?.login ?? '');
      if (!login) {
        const name = cleanString(contributor?.name ?? '');
        const excludedAutomated = isAutomatedContributorIdentity(name, cleanString);
        return {
          contributor,
          profile: null,
          socialAccounts: [],
          author: excludedAutomated || !name || isLikelyGithubUsername(name, cleanString) ? null : normalizeAuthor({ name }),
          autoFilledOrcid: false,
          excludedAutomated,
        };
      }

      if (isAutomatedContributor(contributor, null, cleanString)) {
        return {
          contributor,
          profile: null,
          socialAccounts: [],
          author: null,
          autoFilledOrcid: false,
          excludedAutomated: true,
        };
      }

      const profile = await fetchOptionalJson(
        buildGithubUserApiUrl(login),
        buildGithubRequestConfig({
          authToken,
          source: 'contributor-profile',
          label: `the profile for ${login}`,
          onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
        }),
      );

      if (!profile) {
        return {
          contributor,
          profile: null,
          socialAccounts: [],
          author: null,
          autoFilledOrcid: false,
          excludedAutomated: false,
        };
      }

      const socialAccounts = await fetchOptionalJson(
        buildGithubUserSocialAccountsApiUrl(login),
        buildGithubRequestConfig({
          authToken,
          source: 'contributor-profile-links',
          label: `the profile links for ${login}`,
          onWarning: (source, code, message, details = {}) => addWarning(warnings, source, code, message, details),
        }),
      ) || [];

      if (isAutomatedContributor(contributor, profile, cleanString)) {
        return {
          contributor,
          profile,
          socialAccounts,
          author: null,
          autoFilledOrcid: false,
          excludedAutomated: true,
        };
      }

      let profileOrcid = extractOrcidFromGithubProfile(profile, socialAccounts);

      if (profile?.name && !matchesGithubLoginName(profile.name, login, cleanString)) {
        return {
          contributor,
          profile,
          socialAccounts,
          author: normalizeAuthor({
            name: profile.name,
            affiliation: profile.company ?? '',
            orcid: profileOrcid,
          }),
          autoFilledOrcid: Boolean(profileOrcid),
          excludedAutomated: false,
        };
      }

      return {
        contributor,
        profile,
        socialAccounts,
        author: null,
        autoFilledOrcid: false,
        excludedAutomated: false,
      };
    }),
  );

  const excludedAutomatedCount = profiles.filter((entry) => entry?.excludedAutomated).length;
  if (excludedAutomatedCount > 0) {
    addWarning(
      warnings,
      'authors',
      'automated-contributors-excluded',
      `Excluded ${excludedAutomatedCount} automated account(s) from fallback authors.`,
      { owner, repo },
    );
  }

  const autoFilledOrcidCount = profiles.filter((entry) => entry?.autoFilledOrcid).length;
  if (autoFilledOrcidCount > 0) {
    addWarning(
      warnings,
      'authors',
      'orcid-autofilled',
      `Auto-filled ORCID for ${autoFilledOrcidCount} contributor(s) from GitHub profile data.`,
      { owner, repo },
    );
  }

  const eligibleFallbackAuthors = profiles
    .filter((entry) => !entry?.excludedAutomated)
    .map((entry) => entry?.author)
    .filter(Boolean);
  const fallbackAuthors = contributorFallbackLimit === null
    ? eligibleFallbackAuthors
    : eligibleFallbackAuthors.slice(0, contributorFallbackLimit);
  const lookupAuthors = profiles.map((entry) => entry?.author);

  return {
    fallbackAuthors: dedupeAuthors(normalizeAuthors(fallbackAuthors)),
    lookupAuthors: dedupeAuthors(normalizeAuthors(lookupAuthors)),
    githubLogins: contributors
      .map((contributor) => cleanString(contributor?.login ?? '').toLowerCase())
      .filter(Boolean),
  };
}
