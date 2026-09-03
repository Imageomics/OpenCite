import { toZenodoOrcid } from './orcid.js';

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

export function parseAuthors(authorsInput) {
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
