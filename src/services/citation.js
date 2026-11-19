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

function sanitizeCffType(value, fallback = 'article') {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallback;
  }

  // Strip inline explanatory comments, e.g. "software (python package)".
  const withoutParens = raw.replace(/\s*\([^)]*\)\s*$/g, '').trim();
  const token = withoutParens.toLowerCase().split(/\s+/)[0] || '';
  const normalized = token.replace(/[^a-z0-9-]/g, '');

  return normalized || fallback;
}

export function toCitationCff(metadata) {
  const typeOfWork = sanitizeCffType(metadata.typeOfWork, 'software');
  const repositoryCode = metadata.repositoryCode || 'https://github.com/Imageomics/repository';
  const releaseTag = String(metadata.releaseTag ?? '').trim() || String(metadata.version ?? '').trim();
  const releaseUrl = releaseTag ? `${repositoryCode}/releases/tag/${encodeURIComponent(releaseTag)}` : '';
  const releaseCommit = String(metadata.releaseCommit ?? '').trim();
  const commitUrl = releaseTag && /^[0-9a-f]{7,40}$/i.test(releaseCommit)
    ? `${repositoryCode}/commit/${releaseCommit}`
    : '';
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
  // References are exported only in .zenodo.json: Zenodo does not read CITATION.cff
  // references, and plain-text citations cannot be mapped to CFF's structured
  // reference schema (which requires authors) without loss.
  const abstractText = metadata.abstract || 'No abstract provided.';
  const citationMessage = 'If you find this work helpful in your research, please cite it.';

  return [
    'abstract: >-',
    indentBlock(abstractText),
    'authors:',
    ...(authors.length
      ? authors
      : ['- family-names: "Unknown"', '  given-names: "Author"', '  orcid: "https://orcid.org/0000-0000-0000-0000"']),
    'cff-version: 1.2.0',
    `date-released: "${quoteYAML(metadata.publicationDate || 'YYYY-MM-DD')}"`,
    ...(releaseUrl
      ? [
          'identifiers:',
          `  - description: "The GitHub release URL of tag ${quoteYAML(releaseTag)}."`,
          '    type: url',
          `    value: "${quoteYAML(releaseUrl)}"`,
          ...(commitUrl
            ? [
                `  - description: "The GitHub URL of the commit tagged with ${quoteYAML(releaseTag)}."`,
                '    type: url',
                `    value: "${quoteYAML(commitUrl)}" # Update on release`,
              ]
            : []),
        ]
      : []),
    'keywords:',
    ...keywords,
    `license: "${quoteYAML(metadata.license)}"`,
    `message: "${quoteYAML(citationMessage)}"`,
    `repository-code: "${quoteYAML(repositoryCode)}"`,
    `title: "${quoteYAML(metadata.title)}"`,
    `version: "${quoteYAML(metadata.version)}"`,
    ...(metadata.doi ? [`doi: "${quoteYAML(metadata.doi)}"`] : []),
    `type: ${quoteYAML(typeOfWork)}`,
    '',
  ].join('\n');
}
