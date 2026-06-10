import { parseAuthors } from '../utils/authors.js';
import { normalizeGrants } from '../utils/grants.js';
import { normalizeKeywords } from '../utils/keywords.js';
import { normalizeReferences } from '../utils/references.js';

const zenodoUploadTypeMap = {
  software: 'software',
  article: 'publication',
  dataset: 'dataset',
  other: 'other',
};

export function normalizeMetadata(form) {
  const authors = parseAuthors(form.authors ?? []);
  const keywords = normalizeKeywords(form.keywords ?? '');
  const references = normalizeReferences(form.references ?? '');
  const grants = normalizeGrants(form.grants ?? '');
  const typeOfWork = form.typeOfWork;

  return {
    title: form.title ?? '',
    authors,
    keywords,
    license: form.license ?? '',
    typeOfWork,
    customTypeOfWork: form.customTypeOfWork ?? '',
    zenodoUploadType: zenodoUploadTypeMap[typeOfWork] ?? 'other',
    version: form.version ?? '',
    publicationDate: form.publicationDate ?? '',
    repositoryCode: form.repositoryCode ?? '',
    doi: form.doi ?? '',
    abstract: form.abstract ?? '',
    references,
    grants,
  };
}
