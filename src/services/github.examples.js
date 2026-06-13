/**
 * Example usage of githubToMetadata
 *
 * This demonstrates how to use the GitHub metadata importer to populate
 * OpenCite form fields from a GitHub repository.
 */

import { githubToMetadata } from '../services/github.js';

/**
 * Example: Fetch metadata from a GitHub repository and populate form
 */
export async function exampleImportGitHubRepo() {
  try {
    const repoUrl = 'https://github.com/imageomics/OpenCite';

    const { metadata, sourceData } = await githubToMetadata(repoUrl);

    // Use metadata to populate form fields
    const formData = {
      title: metadata.title,
      authors: metadata.authors,
      keywords: metadata.keywords.join(', '),
      license: metadata.license,
      typeOfWork: metadata.typeOfWork,
      customTypeOfWork: metadata.customTypeOfWork,
      version: metadata.version,
      publicationDate: metadata.publicationDate,
      repositoryCode: metadata.repositoryCode,
      doi: metadata.doi,
      abstract: metadata.abstract,
      references: metadata.references.join('\n'),
      grants: metadata.grants.join('\n'),
    };

    console.log('Populated form data:', formData);
    console.log('Source data from GitHub:', sourceData);

    return { formData, sourceData };
  } catch (error) {
    console.error('Failed to import GitHub repository:', error.message);
    throw error;
  }
}

/**
 * Example: Handle errors gracefully
 */
export async function exampleErrorHandling() {
  const testCases = [
    { url: 'https://github.com/nonexistent/repo', description: 'Nonexistent repository' },
    { url: 'https://invalid.url', description: 'Invalid URL' },
    { url: 'https://github.com/imageomics', description: 'Missing repo name' },
  ];

  for (const testCase of testCases) {
    try {
      console.log(`Testing: ${testCase.description}`);
      await githubToMetadata(testCase.url);
    } catch (error) {
      console.error(`  Error: ${error.message}`);
    }
  }
}

/**
 * Example: Repos without releases are handled gracefully
 * This demonstrates that the importer works even if a repo has no release tags
 */
export async function exampleRepoWithoutReleases() {
  try {
    const repoUrl = 'https://github.com/imageomics/OpenCite';
    const { metadata, sourceData } = await githubToMetadata(repoUrl);

    console.log('Title:', metadata.title);
    console.log('Version (from latest release, or empty if none):', metadata.version);
    console.log('Publication date (repo creation):', metadata.publicationDate);
    console.log('Latest release info:', sourceData.latestRelease);

    return { metadata, sourceData };
  } catch (error) {
    console.error('Failed:', error.message);
  }
}
