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

function sanitizeReferenceTitle(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toCitationReferenceEntry(reference) {
  if (reference && typeof reference === 'object' && !Array.isArray(reference)) {
    const type = sanitizeCffType(reference.type, 'article');
    const normalizedTitle = String(reference.title || reference.reference || reference.text || '').trim();
    const normalizedVersion = String(reference.version || '').trim();
    const normalizedRepositoryCode = String(reference['repository-code'] || '').trim();
    const normalizedDateReleased = String(reference['date-released'] || '').trim();
    const normalizedDoi = String(reference.doi || '').trim();
    const normalizedLicense = String(reference.license || '').trim();
    const normalizedUrl = String(reference.url || '').trim();

    const hasScalarContent = Boolean(normalizedTitle || normalizedDoi || normalizedUrl);

    const normalizedAuthors = Array.isArray(reference.authors)
      ? reference.authors
        .filter((author) => author && typeof author === 'object')
        .map((author) => ({
          familyNames: String(author['family-names'] ?? '').trim(),
          givenNames: String(author['given-names'] ?? '').trim(),
          orcid: String(author.orcid ?? '').trim(),
        }))
        .filter((author) => author.familyNames || author.givenNames || author.orcid)
      : [];

    if (!hasScalarContent) {
      return [];
    }

    const title = sanitizeReferenceTitle(
      normalizedTitle
      || (normalizedDoi ? `DOI: ${normalizedDoi}` : '')
      || (normalizedUrl ? `URL: ${normalizedUrl}` : ''),
    );

    if (!title) {
      return [];
    }

    const lines = [`  - type: ${quoteYAML(type)}`];

    lines.push(`    title: "${quoteYAML(title)}"`);

    if (normalizedDoi) {
      lines.push(`    doi: ${quoteYAML(normalizedDoi)}`);
    }
    if (normalizedUrl) {
      lines.push(`    url: "${quoteYAML(normalizedUrl)}"`);
    }

    if (normalizedVersion) {
      lines.push(`    version: "${quoteYAML(normalizedVersion)}"`);
    }
    if (normalizedRepositoryCode) {
      lines.push(`    repository-code: "${quoteYAML(normalizedRepositoryCode)}"`);
    }
    if (normalizedDateReleased) {
      lines.push(`    date-released: "${quoteYAML(normalizedDateReleased)}"`);
    }
    if (normalizedLicense) {
      lines.push(`    license: "${quoteYAML(normalizedLicense)}"`);
    }

    if (normalizedAuthors.length > 0) {
      lines.push('    authors:');

      for (const author of normalizedAuthors) {
        const familyNames = author.familyNames;
        const givenNames = author.givenNames;
        const orcid = author.orcid;
        lines.push(`      - family-names: "${quoteYAML(familyNames)}"`);
        lines.push(`        given-names: "${quoteYAML(givenNames)}"`);
        if (orcid) {
          lines.push(`        orcid: "${quoteYAML(orcid)}"`);
        }
      }
    }

    return lines;
  }

  const text = String(reference ?? '').trim();
  if (!text) {
    return [];
  }

  const doiMatch = text.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)(10\.\d{4,9}\/[\w./;():-]+)/i);
  if (doiMatch) {
    const doi = doiMatch[1].replace(/[.,;:]+$/g, '');
    return [
      '  - type: article',
      `    title: "${quoteYAML(sanitizeReferenceTitle(text))}"`,
      `    doi: ${quoteYAML(doi)}`,
      `    url: "${quoteYAML(`https://doi.org/${doi}`)}"`,
    ];
  }

  if (/^https?:\/\//i.test(text)) {
    return [
      '  - type: article',
      `    title: "${quoteYAML(sanitizeReferenceTitle(text))}"`,
      `    url: "${quoteYAML(text)}"`,
    ];
  }

  return [
    '  - type: article',
    `    title: "${quoteYAML(sanitizeReferenceTitle(text))}"`,
  ];
}

export function toCitationCff(metadata) {
  const typeOfWork = sanitizeCffType(metadata.typeOfWork, 'software');
  const typeLabel = typeOfWork === 'other'
    ? (metadata.customTypeOfWork || 'other')
    : typeOfWork;
  const repositoryCode = metadata.repositoryCode || 'https://github.com/Imageomics/repository';
  const releaseTag = String(metadata.version ?? '').trim();
  const releaseUrl = releaseTag ? `${repositoryCode}/releases/tag/${releaseTag}` : '';
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
  const references = (Array.isArray(metadata.references) ? metadata.references : [])
    .flatMap((reference) => toCitationReferenceEntry(reference));
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
    ...(releaseUrl
      ? [
          'identifiers:',
          `  - description: "The GitHub release URL of tag ${quoteYAML(releaseTag)}."`,
          '    type: url',
          `    value: "${quoteYAML(releaseUrl)}"`,
        ]
      : []),
    'keywords:',
    ...keywords,
    ...(references.length > 0 ? ['references:', ...references] : []),
    `license: "${quoteYAML(metadata.license)}"`,
    `message: "If you find this ${quoteYAML(typeLabel)} helpful in your research, please cite both the ${quoteYAML(typeLabel)} and our paper."`,
    `repository-code: "${quoteYAML(repositoryCode)}"`,
    `title: "${quoteYAML(metadata.title)}"`,
    `version: "${quoteYAML(metadata.version)}"`,
    ...(metadata.doi ? [`doi: "${quoteYAML(metadata.doi)}"`] : []),
    `type: ${quoteYAML(typeOfWork)}`,
    '',
  ].join('\n');
}
