const API_BASE = 'https://api.github.com';

function cleanString(value) {
  return String(value ?? '').replace(/[\t ]+/g, ' ').trim();
}

export function parseGithubUrl(repoUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(repoUrl);
  } catch {
    throw new Error('Invalid GitHub repository URL.');
  }

  const host = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'github.com') {
    throw new Error('Only GitHub repository URLs are supported.');
  }

  const parts = parsedUrl.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length < 2) {
    throw new Error('Expected a repository URL in the form https://github.com/owner/repo.');
  }

  const [owner, repoRaw] = parts;
  return { owner, repo: repoRaw.replace(/\.git$/i, '') };
}

function encodePath(path) {
  return String(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodeBase64(content) {
  const normalized = String(content ?? '').replace(/\s+/g, '');

  if (!normalized) {
    return '';
  }

  if (typeof atob === 'function') {
    const binary = atob(normalized);

    if (typeof TextDecoder === 'function') {
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    }

    return binary;
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(normalized, 'base64').toString('utf8');
  }

  return '';
}

function responseMessage(response, payload) {
  if (payload && typeof payload === 'object' && payload.message) {
    return String(payload.message);
  }

  return `${response.status} ${response.statusText}`.trim();
}

export function resolveGithubToken(options = {}) {
  const explicitToken = cleanString(options.authToken ?? '');
  if (explicitToken) {
    return explicitToken;
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const localToken = cleanString(window.localStorage.getItem('opencite_github_token') ?? '');
      if (localToken) {
        return localToken;
      }
    }
  } catch {
    // localStorage access can fail in restricted browsing contexts.
  }

  return '';
}

export function buildGithubRequestConfig({ authToken = '', source = '', label = '', onWarning = () => {} } = {}) {
  return { authToken, source, label, onWarning };
}

export function buildGithubRepoApiUrl(owner, repo) {
  return `${API_BASE}/repos/${owner}/${repo}`;
}

export function buildGithubReleaseApiUrl(owner, repo) {
  return `${API_BASE}/repos/${owner}/${repo}/releases/latest`;
}

export function buildGithubCommitListApiUrl(owner, repo, defaultBranch = '') {
  const branchFilter = defaultBranch ? `&sha=${encodeURIComponent(defaultBranch)}` : '';
  return `${API_BASE}/repos/${owner}/${repo}/commits?per_page=1${branchFilter}`;
}

export function buildGithubBranchApiUrl(owner, repo, branch) {
  return `${API_BASE}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`;
}

export function buildGithubContentsApiUrl(owner, repo, path, ref) {
  return `${API_BASE}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;
}

export function buildGithubContributorsApiUrl(owner, repo, page, perPage = 100) {
  return `${API_BASE}/repos/${owner}/${repo}/contributors?per_page=${perPage}&page=${page}`;
}

export function buildGithubUserApiUrl(login) {
  return `${API_BASE}/users/${encodeURIComponent(login)}`;
}

export function buildGithubUserSocialAccountsApiUrl(login) {
  return `${API_BASE}/users/${encodeURIComponent(login)}/social_accounts`;
}

export function createGithubHeaders(token = '') {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export async function fetchJson(url, authToken = '') {
  let response;

  try {
    response = await fetch(url, {
      headers: createGithubHeaders(authToken),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: 'Network error',
      data: null,
      rateLimited: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    data,
    rateLimited: response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0',
  };
}

export async function fetchRequiredJson(url, { authToken = '', source, onError }) {
  const result = await fetchJson(url, authToken);

  if (!result.ok) {
    const message = result.rateLimited
      ? 'GitHub API rate limit exceeded.'
      : responseMessage(result, result.data);
    onError(source, result.rateLimited ? 'rate-limited' : 'request-failed', message, { url });
    return null;
  }

  return result.data;
}

export async function fetchOptionalJson(url, { authToken = '', source, label, onWarning }) {
  const result = await fetchJson(url, authToken);

  if (!result.ok) {
    if (result.status === 404) {
      return null;
    }

    const message = result.rateLimited
      ? `GitHub API rate limit exceeded while fetching ${label}.`
      : `${label} unavailable: ${responseMessage(result, result.data)}`;
    onWarning(source, result.rateLimited ? 'rate-limited' : 'request-failed', message, { url });
    return null;
  }

  return result.data;
}

export async function fetchLatestCommitDate(owner, repo, defaultBranch, { authToken = '', onWarning }) {
  const branchFilter = defaultBranch ? `&sha=${encodeURIComponent(defaultBranch)}` : '';
  const commits = await fetchOptionalJson(
    `${API_BASE}/repos/${owner}/${repo}/commits?per_page=1${branchFilter}`,
    buildGithubRequestConfig({
      authToken,
      source: 'commits',
      label: 'the latest commit',
      onWarning,
    }),
  );

  if (!Array.isArray(commits) || commits.length === 0) {
    return '';
  }

  return cleanString(commits[0]?.commit?.committer?.date ?? commits[0]?.commit?.author?.date ?? '');
}

export async function fetchContentsFile(owner, repo, path, ref, { authToken = '', onWarning }) {
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;
  const result = await fetchJson(url, authToken);

  if (!result.ok) {
    if (result.status === 404) {
      return null;
    }

    onWarning(
      'contents',
      result.rateLimited ? 'rate-limited' : 'request-failed',
      result.rateLimited
        ? `GitHub API rate limit exceeded while fetching ${path}.`
        : `Unable to fetch ${path}: ${responseMessage(result, result.data)}`,
      { path, url },
    );
    return null;
  }

  const payload = result.data;
  if (!payload || Array.isArray(payload)) {
    onWarning('contents', 'unexpected-response', `GitHub returned an unexpected payload for ${path}.`, { path, url });
    return null;
  }

  if (payload.truncated && payload.download_url) {
    const rawResult = await fetchJson(payload.download_url, authToken);
    if (rawResult.ok) {
      return typeof rawResult.data === 'string' ? rawResult.data : '';
    }

    onWarning('contents', 'request-failed', `Unable to fetch the full contents of ${path}.`, { path, url });
    return null;
  }

  if (payload.encoding === 'base64' && payload.content) {
    return decodeBase64(payload.content);
  }

  return '';
}