import {
  buildGithubContributorsApiUrl,
  buildGithubRequestConfig,
  buildGithubUserApiUrl,
  buildGithubUserSocialAccountsApiUrl,
} from './githubApi.js';
import { dedupeAuthors } from './githubImporterAuthors.js';

const TOP_CONTRIBUTOR_FALLBACK_LIMIT = 4;
const MAX_CONTRIBUTOR_FALLBACK_LIMIT = 20;
const GITHUB_PAGE_SIZE = 100;

async function fetchOrcidFromGithubProfileHtml(profileUrl, cleanString, extractOrcidFromGithubHtml) {
  const url = cleanString(profileUrl);
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html',
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return extractOrcidFromGithubHtml(html);
  } catch {
    return null;
  }
}

function isAutomatedContributorIdentity(value, cleanString) {
  const text = cleanString(value ?? '').trim();
  if (!text) {
    return false;
  }

  const normalized = text.toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }

  if (normalized.includes('[bot]') || normalized.endsWith('-bot') || normalized.startsWith('bot-') || normalized.includes('-bot')) {
    return true;
  }

  const singleTokenAutomation = new Set([
    'claude',
    'copilot',
    'codex',
    'dependabot',
    'chatgpt',
    'gpt',
    'openai',
    'assistant',
    'ai',
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

  if ((first === 'claude' || first === 'copilot' || first === 'swe') && secondTokenIsAutomationKeyword) {
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
    'ai assistant',
  ].some((phrase) => combinedPhrase.includes(phrase));
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

    contributors.push(...pageContributors);

    if (maxContributors && contributors.length >= maxContributors) {
      return contributors.slice(0, maxContributors);
    }

    if (pageContributors.length < GITHUB_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return contributors;
}

export function resolveContributorFallbackLimit(options = {}) {
  if (!Object.prototype.hasOwnProperty.call(options, 'contributorFallbackLimit')) {
    return TOP_CONTRIBUTOR_FALLBACK_LIMIT;
  }

  if (options.contributorFallbackLimit == null || options.contributorFallbackLimit === '') {
    return null;
  }

  const rawLimit = Number(options.contributorFallbackLimit);

  if (!Number.isFinite(rawLimit)) {
    return TOP_CONTRIBUTOR_FALLBACK_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_CONTRIBUTOR_FALLBACK_LIMIT);
}

export function extractCoAuthorNamesFromCommitMessage(message) {
  const names = new Set();
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

    if (!rawName || isAutomatedContributorIdentity(rawName, (value) => String(value ?? ''))) {
      continue;
    }

    names.add(rawName);
  }

  return [...names];
}

export async function fetchContributorAuthors({
  owner,
  repo,
  warnings,
  authToken = '',
  contributorFallbackLimit = TOP_CONTRIBUTOR_FALLBACK_LIMIT,
  emitFallbackWarning = true,
  cleanString,
  normalizeAuthor,
  normalizeAuthors,
  addWarning,
  fetchOptionalJson,
  extractOrcidFromGithubProfile,
  extractOrcidFromGithubHtml,
}) {
  const contributors = await fetchAllContributors(owner, repo, warnings, authToken, contributorFallbackLimit, {
    fetchOptionalJson,
    addWarning,
  });

  if (!Array.isArray(contributors) || contributors.length === 0) {
    return {
      fallbackAuthors: [],
      lookupAuthors: [],
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
        return {
          contributor,
          profile: null,
          socialAccounts: [],
          author: null,
          autoFilledOrcid: false,
          excludedAutomated: false,
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
      if (!profileOrcid) {
        profileOrcid = await fetchOrcidFromGithubProfileHtml(
          profile?.html_url ?? contributor?.html_url ?? '',
          cleanString,
          extractOrcidFromGithubHtml,
        );
      }

      if (profile?.name) {
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
        author: normalizeAuthor({
          name: login,
          affiliation: '',
          orcid: profileOrcid,
        }),
        autoFilledOrcid: Boolean(profileOrcid),
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

  const fallbackAuthors = profiles
    .slice(0, contributorFallbackLimit ?? profiles.length)
    .map((entry) => entry?.author);
  const lookupAuthors = profiles.map((entry) => entry?.author);

  return {
    fallbackAuthors: dedupeAuthors(normalizeAuthors(fallbackAuthors)),
    lookupAuthors: dedupeAuthors(normalizeAuthors(lookupAuthors)),
  };
}
