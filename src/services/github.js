import { createMetadata } from '../core/metadataModel.js';

/**
 * Parse a GitHub repository URL to extract owner and repo name
 * @param {string} url - GitHub repository URL (e.g., https://github.com/user/repo)
 * @returns {{owner: string, repo: string}}
 * @throws {Error} if URL is invalid
 */
function parseGithubUrl(url) {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname.split('/').filter(Boolean);

  if (pathname.length < 2) {
    throw new Error('Invalid GitHub repository URL. Expected format: https://github.com/owner/repo');
  }

  const [owner, repo] = pathname;

  if (!owner || !repo) {
    throw new Error('Could not extract owner and repo from URL');
  }

  return { owner, repo };
}

/**
 * Fetch repository data from GitHub REST API
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<Object>}
 * @throws {Error} if API request fails
 */
async function fetchRepoData(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Repository not found: ${owner}/${repo}`);
    }
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch the latest release for a repository
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<Object|null>} Latest release object or null if no releases
 */
async function fetchLatestRelease(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
    },
  });

  // 404 is expected if no releases exist
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    // Log but don't throw; release data is optional
    console.warn(`Could not fetch latest release: ${response.status} ${response.statusText}`);
    return null;
  }

  const data = await response.json();
  return data;
}

/**
 * Fetch the default branch's commit SHA
 * @param {string} owner
 * @param {string} repo
 * @param {string} defaultBranch
 * @returns {Promise<string|null>} Commit SHA or null on error
 */
async function fetchDefaultBranchSha(owner, repo, defaultBranch) {
  if (!defaultBranch) {
    return null;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=1`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    console.warn(`Could not fetch default branch commit SHA: ${response.status} ${response.statusText}`);
    return null;
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  return data[0].sha;
}

/**
 * Convert GitHub SPDX license identifier to OpenCite format
 * @param {string|null} spdxId - SPDX license identifier from GitHub (e.g., 'MIT', 'Apache-2.0')
 * @returns {string} OpenCite license string or empty string
 */
function mapGithubLicense(spdxId) {
  if (!spdxId) {
    return '';
  }

  // GitHub returns SPDX identifiers, which match our license list directly
  const supportedLicenses = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-3.0-only', 'CC-BY-4.0', 'CC0-1.0'];
  return supportedLicenses.includes(spdxId) ? spdxId : '';
}

/**
 * Determine type of work based on repository characteristics
 * @param {Object} repoData - GitHub repository data
 * @returns {string} 'software', 'dataset', 'article', or 'other'
 */
function inferTypeOfWork(repoData) {
  // Use 'software' as default for code repositories
  // Users can customize later
  return 'software';
}

/**
 * Extract GitHub topics and map to keywords
 * @param {string[]|undefined} topics - GitHub topics array
 * @returns {string[]}
 */
function extractKeywords(topics) {
  if (!Array.isArray(topics)) {
    return [];
  }
  return topics.map((t) => String(t).toLowerCase().trim()).filter(Boolean);
}

/**
 * Convert GitHub repository metadata to OpenCite ProjectMetadata
 * @param {string} repoUrl - GitHub repository URL
 * @returns {Promise<{metadata: import('../core/metadataModel.js').ProjectMetadata, sourceData: Object}>}
 * @throws {Error} if repository cannot be fetched or URL is invalid
 */
export async function githubToMetadata(repoUrl) {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('Repository URL must be a non-empty string');
  }

  // Parse the URL
  const { owner, repo } = parseGithubUrl(repoUrl.trim());

  // Fetch repository data
  const repoData = await fetchRepoData(owner, repo);

  // Attempt to fetch optional data (don't fail if unavailable)
  const latestRelease = await fetchLatestRelease(owner, repo);
  const defaultBranchSha = await fetchDefaultBranchSha(owner, repo, repoData.default_branch);

  // Extract publication date (repository creation date)
  const createdAt = repoData.created_at ? new Date(repoData.created_at).toISOString().split('T')[0] : '';

  // Extract version from latest release or use empty string
  const version = latestRelease?.tag_name || '';

  // Construct repository owner as author
  const owner_data = repoData.owner || {};
  const ownerAuthor = {
    givenNames: owner_data.name ? owner_data.name.split(/\s+/).slice(0, -1).join(' ') : '',
    familyNames: owner_data.name ? owner_data.name.split(/\s+/).pop() : owner,
    orcid: '',
    affiliation: owner_data.company || '',
  };

  // Filter empty authors
  const authors = [ownerAuthor].filter((a) => a.familyNames || a.givenNames);

  // Map GitHub license
  const license = mapGithubLicense(repoData.license?.spdx_id);

  // Extract keywords from topics
  const keywords = extractKeywords(repoData.topics);

  // Create normalized metadata
  const metadata = createMetadata({
    title: repoData.name || '',
    authors,
    keywords,
    license,
    typeOfWork: inferTypeOfWork(repoData),
    customTypeOfWork: '',
    zenodoUploadType: 'software',
    version,
    publicationDate: createdAt,
    repositoryCode: repoData.html_url || repoUrl,
    doi: '',
    abstract: repoData.description || '',
    references: [],
    grants: [],
  });

  return {
    metadata,
    sourceData: {
      repositoryUrl: repoUrl,
      owner,
      repo,
      ownerProfile: {
        login: owner_data.login,
        avatarUrl: owner_data.avatar_url,
        profileUrl: owner_data.html_url,
      },
      latestRelease: latestRelease ? {
        tagName: latestRelease.tag_name,
        publishedAt: latestRelease.published_at,
        prerelease: latestRelease.prerelease,
      } : null,
      defaultBranchSha,
      createdAt: repoData.created_at,
      updatedAt: repoData.updated_at,
      starsCount: repoData.stargazers_count,
      forksCount: repoData.forks_count,
    },
  };
}
