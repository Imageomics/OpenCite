import { useMemo, useState } from 'react';

const initialForm = {
  title: '',
  authors: [{ givenNames: '', familyNames: '', orcid: '', affiliation: '' }],
  license: '',
  keywords: '',
  typeOfWork: 'software',
  version: '',
  publicationDate: '',
  repositoryCode: '',
  doi: '',
  abstract: '',
  references: '',
  grants: '',
};

const typeOptions = [
  { value: 'article', label: 'Article' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'software', label: 'Software' },
  { value: 'other', label: 'Other' },
];

const zenodoUploadTypeMap = {
  software: 'software',
  article: 'publication',
  dataset: 'dataset',
  other: 'other',
};

const licenseOptions = [
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'GPL-3.0-only',
  'CC-BY-4.0',
  'CC0-1.0',
];

function normalizeKeywords(keywordsString) {
  return [...new Set(
    String(keywordsString ?? '')
      .split(',')
      .map((keyword) => keyword.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function normalizeReferences(referencesText) {
  return String(referencesText ?? '')
    .split('\n')
    .map((reference) => reference.trim())
    .filter(Boolean);
}

function normalizeGrants(grantsText) {
  return String(grantsText ?? '')
    .split('\n')
    .filter((grantLine) => grantLine.length > 0);
}

function normalizeOrcid(orcid) {
  const raw = String(orcid ?? '').trim();

  if (!raw) return '';

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  return `https://orcid.org/${raw}`;
}

function toZenodoOrcid(orcid) {
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
      zenodoGivenName: givenNames,
      zenodoFamilyName: familyNames,
      zenodoOrcid: toZenodoOrcid(orcid),
      zenodoAffiliation: affiliation,
    };
    });
}

function quoteYAML(value) {
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

function normalizeMetadata(form) {
  const authors = parseAuthors(form.authors ?? []);
  const keywords = normalizeKeywords(form.keywords ?? '');
  const references = normalizeReferences(form.references ?? '');
  const grants = normalizeGrants(form.grants ?? '');
  const workType = form.typeOfWork;

  return {
    title: form.title ?? '',
    authors: Array.isArray(authors) ? authors : [],
    keywords: Array.isArray(keywords) ? keywords : [],
    license: form.license ?? '',
    workType,
    cffType: workType,
    zenodoUploadType: zenodoUploadTypeMap[workType] ?? 'other',
    version: form.version ?? '',
    publicationDate: form.publicationDate ?? '',
    repositoryCode: form.repositoryCode ?? '',
    doi: form.doi ?? '',
    abstract: form.abstract ?? '',
    references,
    grants, 
  };
}

function toCitationCff(metadata) {
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
    `type: ${quoteYAML(metadata.cffType || 'software')}`,
    '',
  ].join('\n');
}

function toZenodoJson(metadata) {
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

  return JSON.stringify(
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
  );
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function normalizeFormInput(form) {
  const cleanString = (value) => String(value ?? '').replace(/[ \t]+/g, ' ').trim();

  return {
    ...form,
    title: cleanString(form.title),
    typeOfWork: form.typeOfWork,
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
    abstract: cleanString(form.abstract),
    version: cleanString(form.version),
    publicationDate: cleanString(form.publicationDate),
    repositoryCode: cleanString(form.repositoryCode),
    doi: cleanString(form.doi),
    references: String(form.references ?? '').trim(),
    grants: String(form.grants ?? '').trim(),
  };
}

function validateMetadata(form) {
  const normalizedForm = form;
  const metadata = normalizeMetadata(normalizedForm);
  const errors = {};
  const grantPattern = /^[A-Za-z0-9.-]+::[A-Za-z0-9.-]+$/;

  if (!normalizedForm.title) {
    errors.title = 'Title is required';
  }

  if (metadata.authors.length === 0) {
    errors.authors = 'At least one author is required';
  }

  if (!normalizedForm.license) {
    errors.license = 'License is required';
  }

  if (!typeOptions.some((option) => option.value === normalizedForm.typeOfWork)) {
    errors.typeOfWork = 'Type of work is invalid';
  }

  const grantLines = String(normalizedForm.grants ?? '').split('\n');
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

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [previewType, setPreviewType] = useState('citation');
  const normalizedForm = useMemo(() => normalizeFormInput(form), [form]);
  const normalizedMetadata = useMemo(() => normalizeMetadata(normalizedForm), [normalizedForm]);

  const citationPreview = useMemo(() => toCitationCff(normalizedMetadata), [normalizedMetadata]);
  const zenodoPreview = useMemo(() => toZenodoJson(normalizedMetadata), [normalizedMetadata]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateAuthorField(index, field, value) {
    setForm((current) => ({
      ...current,
      authors: current.authors.map((author, i) => (i === index ? { ...author, [field]: value } : author)),
    }));
  }

  function addAuthor() {
    setForm((current) => ({
      ...current,
      authors: [...current.authors, { givenNames: '', familyNames: '', orcid: '', affiliation: '' }],
    }));
  }

  function removeAuthor(index) {
    setForm((current) => ({
      ...current,
      authors:
        current.authors.length > 1
          ? current.authors.filter((_, i) => i !== index)
          : [{ givenNames: '', familyNames: '', orcid: '', affiliation: '' }],
    }));
  }

  function handleDownloadCitation() {
    const errors = validateMetadata(normalizedForm);

    if (Object.keys(errors).length > 0) {
      alert(Object.values(errors).join('\n'));
      return;
    }

    downloadFile('CITATION.cff', citationPreview, 'text/yaml;charset=utf-8');
  }

  function handleDownloadZenodo() {
    const errors = validateMetadata(normalizedForm);

    if (Object.keys(errors).length > 0) {
      alert(Object.values(errors).join('\n'));
      return;
    }

    downloadFile('zenodo.json', zenodoPreview, 'application/json;charset=utf-8');
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="hero">
          <p className="eyebrow">OpenCite</p>
          <h1>Generate citation metadata from one clean form.</h1>
          <p className="lede">
            Fill in the metadata once, then download both <strong>CITATION.cff</strong> and
            <strong> zenodo.json</strong> without a backend.
          </p>
        </div>

        <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
          <label>
            <span>Title</span>
            <input name="title" value={form.title} onChange={updateField} placeholder="Project title" />
          </label>

          <label className="full-width">
            <span>Authors</span>
            <div className="authors-list">
              {form.authors.map((author, index) => (
                <div key={index} className="author-row">
                  <input
                    value={author.givenNames}
                    onChange={(event) => updateAuthorField(index, 'givenNames', event.target.value)}
                    placeholder="Given names"
                  />
                  <input
                    value={author.familyNames}
                    onChange={(event) => updateAuthorField(index, 'familyNames', event.target.value)}
                    placeholder="Family names"
                  />
                  <input
                    value={author.orcid}
                    onChange={(event) => updateAuthorField(index, 'orcid', event.target.value)}
                    placeholder="ORCID (optional)"
                  />
                  <input
                    value={author.affiliation}
                    onChange={(event) => updateAuthorField(index, 'affiliation', event.target.value)}
                    placeholder="Affiliation (optional)"
                  />
                  <button type="button" className="secondary" onClick={() => removeAuthor(index)}>
                    Remove author
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="secondary" onClick={addAuthor}>
              Add author
            </button>
          </label>

          <label>
            <span>License</span>
            <select name="license" value={form.license} onChange={updateField}>
              <option value="">Select SPDX license</option>
              {licenseOptions.map((license) => (
                <option key={license} value={license}>
                  {license}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Keywords</span>
            <input
              name="keywords"
              value={form.keywords}
              onChange={updateField}
              placeholder="open science, metadata, citation"
            />
          </label>

          <label>
            <span>Type of work</span>
            <select name="typeOfWork" value={form.typeOfWork} onChange={updateField}>
              {typeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Version</span>
            <input name="version" value={form.version} onChange={updateField} placeholder="1.0.0" />
          </label>

          <label>
            <span>Publication date</span>
            <input
              name="publicationDate"
              value={form.publicationDate}
              onChange={updateField}
              placeholder="YYYY-MM-DD"
            />
          </label>

          <label>
            <span>Repository URL</span>
            <input
              name="repositoryCode"
              value={form.repositoryCode}
              onChange={updateField}
              placeholder="https://github.com/user/repo"
            />
          </label>

          <label>
            <span>DOI</span>
            <input name="doi" value={form.doi} onChange={updateField} placeholder="10.0000/example.doi" />
          </label>

          <label className="full-width">
            <span>Abstract</span>
            <textarea
              name="abstract"
              value={form.abstract}
              onChange={updateField}
              rows="6"
              placeholder="Short description of the work"
            />
          </label>

          <label className="full-width">
            <span>References</span>
            <textarea
              name="references"
              value={form.references}
              onChange={updateField}
              rows="4"
              placeholder="One citation per line"
            />
          </label>

          <label className="full-width">
            <span>Grants</span>
            <textarea
              name="grants"
              value={form.grants}
              onChange={updateField}
              rows="3"
              placeholder="One grant ID per line"
            />
            <small>Format: &lt;funder-code&gt;::&lt;grant-number&gt; (e.g., 021nxhr62::2118240)</small>
          </label>
        </form>

        <div className="actions">
          <button type="button" onClick={handleDownloadCitation}>
            Generate CITATION.cff
          </button>
          <button type="button" className="secondary" onClick={handleDownloadZenodo}>
            Generate zenodo.json
          </button>
        </div>

        <div className="preview">
          <div>
            <h2>Preview</h2>
            <div className="actions">
              <button
                type="button"
                className={previewType === 'citation' ? '' : 'secondary'}
                onClick={() => setPreviewType('citation')}
              >
                CITATION.cff
              </button>
              <button
                type="button"
                className={previewType === 'zenodo' ? '' : 'secondary'}
                onClick={() => setPreviewType('zenodo')}
              >
                zenodo.json
              </button>
            </div>
            <pre>{previewType === 'citation' ? citationPreview : zenodoPreview}</pre>
          </div>
        </div>
      </section>
    </main>
  );
}
