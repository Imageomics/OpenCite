const zenodoUploadTypeMap = {
  software: 'software',
  article: 'publication',
  dataset: 'dataset',
  other: 'other',
};

export function normalizeKeywords(keywordsString) {
  return [...new Set(
    String(keywordsString ?? '')
      .split(',')
      .map((keyword) => keyword.trim().toLowerCase())
      .filter(Boolean),
  )];
}

export function normalizeReferences(referencesText) {
  return String(referencesText ?? '')
    .split('\n')
    .map((reference) => reference.trim())
    .filter(Boolean);
}

export function normalizeGrants(grantsText) {
  return String(grantsText ?? '')
    .split('\n')
    .filter((grantLine) => grantLine.length > 0);
}

export function normalizeOrcid(orcid) {
  const raw = String(orcid ?? '').trim();

  if (!raw) return '';

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  return `https://orcid.org/${raw}`;
}

export function toZenodoOrcid(orcid) {
  return String(orcid ?? '')
    .replace(/^https?:\/\/(www\.)?orcid\.org\//, '')
    .trim();
}

function normalizeAuthorsInput(authorsInput) {
  if (!Array.isArray(authorsInput)) {
    return [];
  }

  return authorsInput.map((author) => ({
    givenNames: String(author?.givenNames ?? ''),
    familyNames: String(author?.familyNames ?? ''),
    orcid: String(author?.orcid ?? ''),
    affiliation: String(author?.affiliation ?? ''),
  }));
}

function parseAuthors(authorsInput) {
  return normalizeAuthorsInput(authorsInput)
    .filter((author) => author.givenNames || author.familyNames)
    .map((author) => {
      const givenNames = author.givenNames;
      const familyNames = author.familyNames;
      const orcid = author.orcid;
      const affiliation = author.affiliation;
      const zenodoName = givenNames && familyNames
        ? `${familyNames}, ${givenNames}`
        : familyNames || givenNames;

      return {
        givenNames,
        familyNames,
        citationAuthor: {
          'given-names': givenNames,
          'family-names': familyNames,
          orcid,
        },
        zenodoName,
        zenodoOrcid: toZenodoOrcid(orcid),
        zenodoAffiliation: affiliation,
      };
    });
}

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
