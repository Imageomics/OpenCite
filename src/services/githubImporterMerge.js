import { createMetadata } from '../core/metadataModel.js';
import {
  cleanString,
  firstNonEmpty,
  normalizeAuthors,
  normalizeGrants,
  normalizeKeywords,
  normalizeReferences,
  normalizeRepoUrl,
  normalizeVersionForCompare,
} from './githubImporterUtils.js';
import {
  dedupeAuthors,
  enrichAuthorsWithContributorData,
  orderAuthorsByContributorRank,
} from './githubImporterAuthors.js';

function addWarning(warnings, source, code, message) {
  warnings.push({ kind: 'warning', source, code, message });
}

function mapTypeOfWork(value) {
  const type = cleanString(value).toLowerCase();

  if (type === 'dataset') {
    return 'dataset';
  }

  if (['article', 'book', 'book-chapter', 'conference-paper', 'journal-article', 'manuscript', 'preprint', 'report', 'thesis'].includes(type)) {
    return 'article';
  }

  if (type === 'other') {
    return 'other';
  }

  return 'software';
}

export function mergeMetadata({
  repo,
  release,
  defaultPublicationDate,
  citation,
  zenodo,
  packageMeta,
  readme,
  contributors,
  contributorLookupAuthors,
  supplementalCitationAuthors = [],
}) {
  const primaryAuthors = [
    ...normalizeAuthors(Array.isArray(citation?.authors) ? citation.authors : []),
    ...normalizeAuthors(Array.isArray(zenodo?.authors) ? zenodo.authors : []),
    ...normalizeAuthors(Array.isArray(packageMeta?.authors) ? packageMeta.authors : []),
    ...normalizeAuthors(Array.isArray(supplementalCitationAuthors) ? supplementalCitationAuthors : []),
  ];
  const authors = [
    ...normalizeAuthors(primaryAuthors),
    ...normalizeAuthors(Array.isArray(contributors) ? contributors : []),
  ];
  const keywords = normalizeKeywords(firstNonEmpty(citation?.keywords, zenodo?.keywords, packageMeta?.keywords, repo?.topics));
  const references = normalizeReferences(firstNonEmpty(zenodo?.references, citation?.references));
  const grants = normalizeGrants(firstNonEmpty(zenodo?.grants));
  const enrichedAuthors = enrichAuthorsWithContributorData(authors, contributorLookupAuthors);
  const dedupedAuthors = dedupeAuthors(enrichedAuthors);
  const orderedAuthors = orderAuthorsByContributorRank(dedupedAuthors, contributorLookupAuthors);

  return createMetadata({
    title: cleanString(firstNonEmpty(citation?.title, zenodo?.title, packageMeta?.title, repo?.name)),
    authors: orderedAuthors,
    keywords,
    license: cleanString(firstNonEmpty(citation?.license, zenodo?.license, packageMeta?.license, repo?.license?.spdx_id)),
    typeOfWork: mapTypeOfWork(firstNonEmpty(zenodo?.typeOfWork, citation?.typeOfWork, 'software')),
    customTypeOfWork: '',
    zenodoUploadType: mapTypeOfWork(firstNonEmpty(zenodo?.typeOfWork, citation?.typeOfWork, 'software')),
    version: cleanString(firstNonEmpty(citation?.version, zenodo?.version, packageMeta?.version, release?.tag_name)),
    publicationDate: cleanString(firstNonEmpty(release?.published_at, citation?.publicationDate, zenodo?.publicationDate, defaultPublicationDate)).split('T')[0],
    repositoryCode: normalizeRepoUrl(firstNonEmpty(repo?.html_url, citation?.repositoryCode, packageMeta?.repositoryCode)),
    doi: cleanString(firstNonEmpty(zenodo?.doi, citation?.doi)),
    abstract: cleanString(firstNonEmpty(citation?.abstract, zenodo?.abstract, packageMeta?.abstract, readme, repo?.description)),
    references,
    grants,
  });
}

export function addCitationConsistencyWarnings({ warnings, citation, zenodo, releaseData, repoData, metadata }) {
  const releaseTag = cleanString(releaseData?.tag_name ?? '');
  const citationVersion = cleanString(citation?.version ?? '');
  const zenodoVersion = cleanString(zenodo?.version ?? '');
  const finalVersion = cleanString(metadata?.version ?? '');
  const normalizedReleaseTag = normalizeVersionForCompare(releaseTag);
  const normalizedCitationVersion = normalizeVersionForCompare(citationVersion);
  const normalizedZenodoVersion = normalizeVersionForCompare(zenodoVersion);

  if (normalizedReleaseTag && normalizedCitationVersion && normalizedReleaseTag !== normalizedCitationVersion) {
    addWarning(warnings, 'citation', 'version-mismatch', `CITATION.cff version (${citationVersion}) differs from latest release tag (${releaseTag}); using CITATION.cff version for import.`);
  }

  if (normalizedReleaseTag && normalizedZenodoVersion && normalizedReleaseTag !== normalizedZenodoVersion) {
    addWarning(warnings, 'zenodo', 'version-mismatch', `.zenodo.json version (${zenodoVersion}) differs from latest release tag (${releaseTag}); using .zenodo.json version for import.`);
  }

  if (normalizedCitationVersion && normalizedZenodoVersion && normalizedCitationVersion !== normalizedZenodoVersion) {
    addWarning(warnings, 'citation', 'cross-file-version-mismatch', `CITATION.cff version (${citationVersion}) and .zenodo.json version (${zenodoVersion}) differ.`);
  }

  const citationDate = cleanString(citation?.publicationDate ?? '').split('T')[0];
  const zenodoDate = cleanString(zenodo?.publicationDate ?? '').split('T')[0];
  const releaseDate = cleanString(releaseData?.published_at ?? '').split('T')[0];

  if (releaseDate && citationDate && releaseDate !== citationDate) {
    addWarning(warnings, 'citation', 'date-mismatch', `CITATION.cff date-released (${citationDate}) differs from latest release date (${releaseDate}); using release date for import.`);
  }

  if (releaseDate && zenodoDate && releaseDate !== zenodoDate) {
    addWarning(warnings, 'zenodo', 'date-mismatch', `.zenodo.json publication_date (${zenodoDate}) differs from latest release date (${releaseDate}); using release date for import.`);
  }

  const repoUrl = normalizeRepoUrl(repoData?.html_url ?? '');
  const citationRepoUrl = normalizeRepoUrl(citation?.repositoryCode ?? '');

  if (repoUrl && citationRepoUrl && repoUrl !== citationRepoUrl) {
    addWarning(warnings, 'citation', 'repository-url-mismatch', `CITATION.cff repository-code (${citationRepoUrl}) differs from repository URL (${repoUrl}); using repository URL for import.`);
  }

  if (!finalVersion) {
    addWarning(warnings, 'citation', 'missing-version', 'No version could be determined from release tag, CITATION.cff, .zenodo.json, or package metadata.');
  }

  const repoSpdx = cleanString(repoData?.license?.spdx_id ?? '').toUpperCase();
  const citationLicense = cleanString(citation?.license ?? '').toUpperCase();
  const zenodoLicense = cleanString(zenodo?.license ?? '').toUpperCase();

  if (repoSpdx && citationLicense && repoSpdx !== citationLicense) {
    addWarning(warnings, 'citation', 'license-mismatch', `CITATION.cff license (${citationLicense}) differs from repository SPDX license (${repoSpdx}); imported metadata keeps source precedence but should be reviewed.`);
  }

  if (repoSpdx && zenodoLicense && repoSpdx !== zenodoLicense) {
    addWarning(warnings, 'zenodo', 'license-mismatch', `.zenodo.json license (${zenodoLicense}) differs from repository SPDX license (${repoSpdx}); imported metadata keeps source precedence but should be reviewed.`);
  }
}
