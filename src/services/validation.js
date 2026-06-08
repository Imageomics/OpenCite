import { normalizeMetadata, normalizeOrcid } from './metadata';

export function normalizeFormInput(form) {
  const cleanString = (value) => String(value ?? '').replace(/[ \t]+/g, ' ').trim();

  return {
    ...form,
    title: cleanString(form.title),
    authors: Array.isArray(form.authors)
      ? form.authors.map((author) => ({
          givenNames: cleanString(author.givenNames),
          familyNames: cleanString(author.familyNames),
          orcid: normalizeOrcid(cleanString(author.orcid)),
          affiliation: cleanString(author.affiliation),
        }))
      : [],
    license: cleanString(form.license),
    keywords: cleanString(form.keywords),
    customTypeOfWork: cleanString(form.customTypeOfWork),
    abstract: cleanString(form.abstract),
    version: cleanString(form.version),
    publicationDate: cleanString(form.publicationDate),
    repositoryCode: cleanString(form.repositoryCode),
    doi: cleanString(form.doi),
    references: String(form.references ?? '').trim(),
    grants: String(form.grants ?? '').trim(),
  };
}

export function validateMetadata(form, typeOptions) {
  const metadata = normalizeMetadata(form);
  const errors = {};
  const grantPattern = /^[A-Za-z0-9.-]+::[A-Za-z0-9.-]+$/;

  if (!form.title) {
    errors.title = 'Title is required';
  }

  if (metadata.authors.length === 0) {
    errors.authors = 'At least one author is required';
  }

  if (!form.license) {
    errors.license = 'License is required';
  }

  if (!typeOptions.some((option) => option.value === form.typeOfWork)) {
    errors.typeOfWork = 'Type of work is invalid';
  }

  if (form.typeOfWork === 'other' && !String(form.customTypeOfWork ?? '').trim()) {
    errors.customTypeOfWork = 'Please specify the type of work when selecting Other';
  }

  const grantLines = String(form.grants ?? '').split('\n');
  for (let index = 0; index < grantLines.length; index += 1) {
    const grantId = grantLines[index];

    if (!grantId.trim()) {
      continue;
    }

    if (!grantPattern.test(grantId)) {
      errors.grants = `Invalid grant ID on line ${index + 1}. Expected format: <funder-code>::<grant-number>`;
      break;
    }
  }

  return errors;
}
