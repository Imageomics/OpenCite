import { normalizeMetadata } from '../metadata/normalizeMetadata.js';
import { isValidOrcidFormat } from '../utils/orcid.js';
import { normalizeOrcid } from '../utils/orcid.js';

function isValidIsoDate(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return true;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }

  const [yearText, monthText, dayText] = text.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isValidSemanticVersion(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return false;
  }

  // Accept SemVer with optional leading "v" (for GitHub tag parity), including prerelease/build metadata.
  return /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(text);
}

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
  const authorOrcidErrors = {};
  const grantPattern = /^[A-Za-z0-9.-]+::[A-Za-z0-9.-]+$/;
  const duplicateAuthorRows = new Set();

  if (!form.title) {
    errors.title = 'Title is required';
  }

  if (metadata.authors.length === 0) {
    errors.authors = 'At least one author is required';
  }

  if (!form.license) {
    errors.license = 'License is required';
  }

  if (!form.version) {
    errors.version = 'Version is required';
  } else if (!isValidSemanticVersion(form.version)) {
    errors.version = 'Version must use Semantic Versioning (for example: 1.2.3 or v1.2.3).';
  }

  if (!typeOptions.some((option) => option.value === form.typeOfWork)) {
    errors.typeOfWork = 'Type of work is invalid';
  }

  if (!form.publicationDate) {
    errors.publicationDate = 'Publication date is required';
  } else if (!isValidIsoDate(form.publicationDate)) {
    errors.publicationDate = 'Publication date must be a real date in YYYY-MM-DD format';
  }

  const authors = Array.isArray(form.authors) ? form.authors : [];
  const seenOrcidRows = new Map();
  const seenNameRows = new Map();

  authors.forEach((author, index) => {
    const orcidKey = String(author?.orcid ?? '').trim().toLowerCase();
    const givenName = String(author?.givenNames ?? '').trim().toLowerCase();
    const familyName = String(author?.familyNames ?? '').trim().toLowerCase();
    const nameKey = givenName && familyName ? `${givenName}|${familyName}` : '';

    if (orcidKey) {
      const firstRow = seenOrcidRows.get(orcidKey);
      if (firstRow !== undefined) {
        duplicateAuthorRows.add(firstRow + 1);
        duplicateAuthorRows.add(index + 1);
      } else {
        seenOrcidRows.set(orcidKey, index);
      }
    }

    if (nameKey) {
      const firstRow = seenNameRows.get(nameKey);
      if (firstRow !== undefined) {
        duplicateAuthorRows.add(firstRow + 1);
        duplicateAuthorRows.add(index + 1);
      } else {
        seenNameRows.set(nameKey, index);
      }
    }

    if (!isValidOrcidFormat(author?.orcid ?? '')) {
      authorOrcidErrors[index] = 'Invalid ORCID (must be a valid 16-digit ORCID, with final checksum that can be X).';
    }
  });

  if (duplicateAuthorRows.size > 0) {
    const rows = [...duplicateAuthorRows].sort((a, b) => a - b);
    errors.authors = `Duplicate author entries found on rows ${rows.join(', ')}. Remove duplicates before export.`;
  }

  if (Object.keys(authorOrcidErrors).length > 0) {
    errors.authorOrcid = authorOrcidErrors;
  }

  const grantLines = String(form.grants ?? '').split('\n');
  for (let index = 0; index < grantLines.length; index += 1) {
    const grantId = grantLines[index].trim();

    if (!grantId) {
      continue;
    }

    if (!grantPattern.test(grantId)) {
      errors.grants = `Invalid grant ID on line ${index + 1}. Expected format: <funder-code>::<grant-number>`;
      break;
    }
  }

  return errors;
}
