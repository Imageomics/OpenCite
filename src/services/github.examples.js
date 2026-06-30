/**
 * Example usage of importGithubMetadata
 *
 * This demonstrates how to use the GitHub metadata importer to populate
 * OpenCite form fields from a GitHub repository.
 */

import { importGithubMetadata } from './githubImporter.js';

/**
 * Example: Fetch metadata from a GitHub repository and populate form
 */
export async function exampleImportGitHubRepo() {
  try {
    const repoUrl = 'https://github.com/imageomics/OpenCite';

    // Default: API-only mode, no file inspection
    const { metadata, warnings, errors } = await importGithubMetadata(repoUrl);

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
    if (warnings.length > 0) {
      console.warn('Import warnings:', warnings);
    }
    if (errors.length > 0) {
      console.error('Import errors:', errors);
    }

    return { formData, metadata };
  } catch (error) {
    console.error('Failed to import GitHub repository:', error.message);
    throw error;
  }
}

/**
 * Example: With optional file inspection
 * Enables inspection of CITATION.cff, .zenodo.json, README, and package metadata files.
 * Use when you want to extract additional fields from repository files.
 */
export async function exampleWithRepositoryFileInspection() {
  try {
    const repoUrl = 'https://github.com/imageomics/OpenCite';

    const { metadata, warnings, errors } = await importGithubMetadata(repoUrl, {
      inspectRepositoryFiles: true,
    });

    console.log('Metadata with file inspection:', metadata);
    if (warnings.length > 0) {
      console.warn('Warnings during import:', warnings);
    }

    return { metadata };
  } catch (error) {
    console.error('Failed:', error.message);
  }
}

/**
 * Example: Custom contributor fallback limit
 * Adjusts how many top contributors by commit count are used as author fallback.
 * Default is 4; can be 1-20.
 */
export async function exampleCustomContributorLimit() {
  try {
    const repoUrl = 'https://github.com/imageomics/OpenCite';

    // Increase contributor fallback to 10 instead of default 4
    const { metadata, warnings } = await importGithubMetadata(repoUrl, {
      contributorFallbackLimit: 10,
    });

    console.log('Authors (from contributor fallback):', metadata.authors);
    console.log('Warnings:', warnings);

    return { metadata };
  } catch (error) {
    console.error('Failed:', error.message);
  }
}

/**
 * Example: Combined options
 * Uses file inspection and sets a custom contributor limit.
 */
export async function exampleWithMultipleOptions() {
  try {
    const repoUrl = 'https://github.com/imageomics/OpenCite';

    const { metadata, warnings, errors } = await importGithubMetadata(repoUrl, {
      inspectRepositoryFiles: true,
      contributorFallbackLimit: 8,
      authToken: import.meta.env?.VITE_GITHUB_TOKEN ?? '',
    });

    console.log('Full metadata:', metadata);
    console.log('Warnings:', warnings);
    console.log('Errors:', errors);

    return { metadata };
  } catch (error) {
    console.error('Failed:', error.message);
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
      const result = await importGithubMetadata(testCase.url);
      if (result.errors.length > 0) {
        console.error(`  Errors: ${result.errors.map((e) => e.message).join('; ')}`);
      }
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
    const { metadata, warnings } = await importGithubMetadata(repoUrl);

    console.log('Title:', metadata.title);
    console.log('Version (from latest release, or empty if none):', metadata.version);
    console.log('Publication date (repo creation):', metadata.publicationDate);
    console.log('Authors (from contributor fallback):', metadata.authors);
    if (warnings.length > 0) {
      console.log('Warnings:', warnings);
    }

    return { metadata };
  } catch (error) {
    console.error('Failed:', error.message);
  }
}
