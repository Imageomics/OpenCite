import { useMemo, useState } from 'react';

const initialForm = {
  title: '',
  authors: [{ givenNames: '', familyNames: '', orcid: '', affiliation: '' }],
  license: 'MIT',
  keywords: '',
  typeOfWork: 'dataset',
  version: '',
  publicationDate: '',
  repositoryCode: '',
  doi: '',
  abstract: '',
};

const typeOptions = [
  { value: 'dataset', label: 'Dataset' },
  { value: 'software', label: 'Software' },
  { value: 'article', label: 'Article' },
  { value: 'other', label: 'Other' },
];

const zenodoUploadTypeMap = {
  dataset: 'dataset',
  software: 'software',
  article: 'publication',
  other: 'other',
};

function splitList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrcid(orcid) {
  const raw = String(orcid ?? '').trim();

  if (!raw) {
    return '';
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  return `https://orcid.org/${raw}`;
}

function parseAuthors(authorsInput) {
  if (!Array.isArray(authorsInput)) {
    return [];
  }

  return authorsInput
    .map((author) => {
      const givenNames = String(author.givenNames ?? '').trim();
      const familyNames = String(author.familyNames ?? '').trim();
      const orcid = normalizeOrcid(author.orcid);
      const affiliation = String(author.affiliation ?? '').trim();

      if (!givenNames && !familyNames) {
        return null;
      }

      const fullName = `${givenNames} ${familyNames}`.trim();
      const zenodoName = givenNames && familyNames ? `${familyNames}, ${givenNames}` : fullName;

      return {
        givenNames,
        familyNames,
        fullName,
        citationAuthor: {
          'given-names': givenNames,
          'family-names': familyNames,
          orcid,
        },
        zenodoName,
        orcid,
        affiliation,
      };
    })
    .filter(Boolean);
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
  const authors = parseAuthors(form.authors);
  const keywords = splitList(form.keywords);
  const workType = form.typeOfWork;

  return {
    title: form.title,
    authors,
    keywords,
    license: form.license,
    workType,
    cffType: workType,
    zenodoUploadType: zenodoUploadTypeMap[workType] ?? 'other',
    version: form.version,
    publicationDate: form.publicationDate,
    repositoryCode: form.repositoryCode,
    doi: form.doi,
    abstract: form.abstract,
  };
}

function toCitationCff(form) {
  const metadata = normalizeMetadata(form);
  const authors = metadata.authors.map((author) => {
    const lines = [
      `- given-names: "${quoteYAML(author.citationAuthor['given-names'])}"`,
      `  family-names: "${quoteYAML(author.citationAuthor['family-names'])}"`,
    ];

    if (author.citationAuthor.orcid) {
      lines.push(`  orcid: "${quoteYAML(author.citationAuthor.orcid)}"`);
    }

    return lines.join('\n');
  });
  const keywords = metadata.keywords.map((keyword) => `  - "${quoteYAML(keyword)}"`);

  return [
    'cff-version: 1.2.0',
    'message: "If you use this work, please cite it using the metadata below."',
    `title: "${quoteYAML(metadata.title)}"`,
    ...(authors.length ? ['authors:', ...authors] : ['authors: []']),
    `license: "${quoteYAML(metadata.license)}"`,
    `type: ${metadata.cffType}`,
    `version: "${quoteYAML(metadata.version)}"`,
    `date-released: "${quoteYAML(metadata.publicationDate)}"`,
    ...(metadata.repositoryCode ? [`repository-code: "${quoteYAML(metadata.repositoryCode)}"`] : []),
    ...(metadata.doi ? [`doi: "${quoteYAML(metadata.doi)}"`] : []),
    ...(keywords.length ? ['keywords:', ...keywords] : ['keywords: []']),
    'abstract: >-',
    indentBlock(metadata.abstract),
    '',
  ].join('\n');
}

function toZenodoJson(form) {
  const metadata = normalizeMetadata(form);

  return JSON.stringify(
    {
      title: metadata.title,
      creators: metadata.authors.map((author) => {
        const creator = { name: author.zenodoName, orcid: author.orcid || '' };

        if (author.affiliation) {
          creator.affiliation = author.affiliation;
        }

        return creator;
      }),
      license: metadata.license,
      keywords: metadata.keywords,
      upload_type: metadata.zenodoUploadType,
      description: metadata.abstract,
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

export default function App() {
  const [form, setForm] = useState(initialForm);

  const citationPreview = useMemo(() => toCitationCff(form), [form]);
  const zenodoPreview = useMemo(() => toZenodoJson(form), [form]);

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
    downloadFile('CITATION.cff', citationPreview, 'text/yaml;charset=utf-8');
  }

  function handleDownloadZenodo() {
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
            <input name="license" value={form.license} onChange={updateField} placeholder="MIT" />
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
            <pre>{citationPreview}</pre>
          </div>
        </div>
      </section>
    </main>
  );
}
