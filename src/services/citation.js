export function quoteYAML(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function indentBlock(value) {
  return String(value ?? '')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

export function toCitationCff(metadata) {
  const typeOfWork = metadata.typeOfWork || 'software';
  const repositoryCode = metadata.repositoryCode || 'https://github.com/Imageomics/repository';
  const releaseTag = metadata.version || 'v0.0.0';
  const releaseUrl = `${repositoryCode}/releases/tag/${releaseTag}`;
  const commitTreeUrl = `${repositoryCode}/tree/${releaseTag}`;
  const authors = metadata.authors.map((author) => {
    const lines = [
      `- family-names: "${quoteYAML(author.citationAuthor['family-names'])}"`,
      `  given-names: "${quoteYAML(author.citationAuthor['given-names'])}"`,
    ];

    if (author.citationAuthor.orcid) {
      lines.push(`  orcid: "${quoteYAML(author.citationAuthor.orcid)}"`);
    }

    return lines.join('\n');
  });
  const keywordsWithDefault = metadata.keywords.includes('imageomics')
    ? metadata.keywords
    : ['imageomics', ...metadata.keywords];
  const keywords = keywordsWithDefault.map(
    (keyword) => `  - "${quoteYAML(keyword)}"`,
  );
  const abstractText = metadata.abstract || 'No abstract provided.';

  return [
    'abstract: >-',
    indentBlock(abstractText),
    'authors:',
    ...(authors.length
      ? authors
      : ['- family-names: "Unknown"', '  given-names: "Author"', '  orcid: "https://orcid.org/0000-0000-0000-0000"']),
    'cff-version: 1.2.0',
    `date-released: "${quoteYAML(metadata.publicationDate || 'YYYY-MM-DD')}"`,
    'identifiers:',
    `  - description: "The GitHub release URL of tag ${quoteYAML(releaseTag)}."`,
    '    type: url',
    `    value: "${quoteYAML(releaseUrl)}"`,
    `  - description: "The GitHub URL of the commit tagged with ${quoteYAML(releaseTag)}."`,
    '    type: url',
    `    value: "${quoteYAML(commitTreeUrl)}"`,
    'keywords:',
    ...keywords,
    `license: "${quoteYAML(metadata.license)}"`,
    'message: "If you find this software helpful in your research, please cite both the software and our paper."',
    `repository-code: "${quoteYAML(repositoryCode)}"`,
    `title: "${quoteYAML(metadata.title)}"`,
    `version: "${quoteYAML(metadata.version)}"`,
    ...(metadata.doi ? [`doi: "${quoteYAML(metadata.doi)}"`] : []),
    `type: ${quoteYAML(typeOfWork)}`,
    '',
  ].join('\n');
}
