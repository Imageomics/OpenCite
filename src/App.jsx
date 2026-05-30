import { useMemo, useState } from 'react';

const initialForm = {
  title: '',
  authors: '',
  license: 'MIT',
  keywords: '',
  typeOfWork: 'dataset',
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

function normalizeKeywords(keywordsString) {
  return [...new Set(
    String(keywordsString ?? '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function normalizeAuthorEntries(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

function parseAuthors(value) {
  return normalizeAuthorEntries(value).map((author) => {
    const parts = author.split(/\s+/).filter(Boolean);

    if (parts.length === 1) {
      return {
        givenNames: '',
        familyNames: parts[0],
        fullName: parts[0],
        citationAuthor: {
          'given-names': '',
          'family-names': parts[0],
          orcid: '',
        },
        zenodoName: parts[0],
      };
    }

    const familyNames = parts[parts.length - 1] || '';
    const givenNames = parts.slice(0, -1).join(' ');

    return {
      givenNames,
      familyNames,
      fullName: `${givenNames} ${familyNames}`.trim(),
      citationAuthor: {
        'given-names': givenNames,
        'family-names': familyNames,
        orcid: '',
      },
      zenodoName: `${familyNames}, ${givenNames}`,
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
  const authors = parseAuthors(form.authors ?? '');
  const keywords = normalizeKeywords(form.keywords ?? '');
  const workType = form.typeOfWork ?? 'other';

  return {
    title: form.title ?? '',
    authors: Array.isArray(authors) ? authors : [],
    keywords: Array.isArray(keywords) ? keywords : [],
    license: form.license || 'MIT',
    workType,
    cffType: workType,
    zenodoUploadType: zenodoUploadTypeMap[workType] ?? 'other',
    abstract: form.abstract ?? '',
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
      creators: metadata.authors.map((author) => ({ name: author.zenodoName })),
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

function normalizeFormInput(form) {
  const cleanString = (value) => String(value ?? '').replace(/[ \t]+/g, ' ').trim();

  return {
    ...form,
    title: cleanString(form.title),
    authors: cleanString(form.authors),
    license: cleanString(form.license),
    keywords: cleanString(form.keywords),
    abstract: cleanString(form.abstract),
  };
}

function validateMetadata(form) {
  const normalizedForm = normalizeFormInput(form);
  const errors = {};

  if (!normalizedForm.title) {
    errors.title = 'Title is required';
  }

  if (!normalizedForm.authors) {
    errors.authors = 'At least one author is required';
  }

  return errors;
}

function canExport(form) {
  const normalizedForm = normalizeFormInput(form);
  return Object.keys(validateMetadata(normalizedForm)).length === 0;
}

export default function App() {
  const [form, setForm] = useState(initialForm);

  const citationPreview = useMemo(() => toCitationCff(form), [form]);
  const zenodoPreview = useMemo(() => toZenodoJson(form), [form]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleDownloadCitation() {
    const normalizedForm = normalizeFormInput(form);
    const errors = validateMetadata(normalizedForm);

    if (!canExport(normalizedForm)) {
      alert(Object.values(errors).join('\n'));
      return;
    }

    downloadFile('CITATION.cff', toCitationCff(normalizedForm), 'text/yaml;charset=utf-8');
  }

  function handleDownloadZenodo() {
    const normalizedForm = normalizeFormInput(form);
    const errors = validateMetadata(normalizedForm);

    if (!canExport(normalizedForm)) {
      alert(Object.values(errors).join('\n'));
      return;
    }

    downloadFile('zenodo.json', toZenodoJson(normalizedForm), 'application/json;charset=utf-8');
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

          <label>
            <span>Authors</span>
            <input
              name="authors"
              value={form.authors}
              onChange={updateField}
              placeholder="Ada Lovelace, Alan Turing"
            />
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
