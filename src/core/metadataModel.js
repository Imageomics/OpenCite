/**
 * @typedef {Object} Author
 * @property {string} givenNames
 * @property {string} familyNames
 * @property {string} orcid
 * @property {string} affiliation
 */

/**
 * @typedef {Object} ProjectMetadata
 * @property {string} title
 * @property {Author[]} authors
 * @property {string[]} keywords
 * @property {string} license
 * @property {string} typeOfWork - 'software', 'article', 'dataset', or 'other'
 * @property {string} customTypeOfWork
 * @property {string} zenodoUploadType - mapped type for Zenodo
 * @property {string} version
 * @property {string} publicationDate - ISO 8601 date string (YYYY-MM-DD)
 * @property {string} repositoryCode - URL to code repository
 * @property {string} doi
 * @property {string} abstract
 * @property {string[]} references
 * @property {string[]} grants - Array of grant strings in format 'funder-code::grant-number'
 */

/**
 * Empty/default metadata structure
 * @type {ProjectMetadata}
 */
export const emptyMetadata = {
  title: '',
  authors: [],
  keywords: [],
  license: '',
  typeOfWork: 'software',
  customTypeOfWork: '',
  zenodoUploadType: 'software',
  version: '',
  publicationDate: '',
  repositoryCode: '',
  doi: '',
  abstract: '',
  references: [],
  grants: [],
};

/**
 * Create partial metadata from GitHub repository data
 * @param {Partial<ProjectMetadata>} partial
 * @returns {ProjectMetadata}
 */
export function createMetadata(partial) {
  return { ...emptyMetadata, ...partial };
}
