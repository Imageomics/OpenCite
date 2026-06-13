export function toZenodoJson(metadata) {
  const keywords = metadata.keywords.includes('imageomics')
    ? metadata.keywords
    : ['imageomics', ...metadata.keywords];
  const creators = metadata.authors.length
    ? metadata.authors.map((author) => ({
        name: author.zenodoName,
        orcid: author.zenodoOrcid || '',
        affiliation: author.zenodoAffiliation || '',
      }))
    : [{ name: 'family-names, given-names', orcid: '', affiliation: '' }];

  return `${JSON.stringify(
    {
      creators,
      upload_type: metadata.zenodoUploadType,
      description: metadata.abstract,
      keywords,
      title: metadata.title,
      version: metadata.version,
      license: metadata.license,
      publication_date: metadata.publicationDate,
      grants: metadata.grants.map((id) => ({ id })),
      references: metadata.references,
    },
    null,
    2,
  )}\n`;
}
