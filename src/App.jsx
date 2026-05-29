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

function splitList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function quoteYAML(value) {
  return String(value ?? '').replace(/"/g, '\\"');
}

function indentBlock(value) {
  return String(value ?? '')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function toCitationCff(form) {
  const authors = splitList(form.authors).map((name) => `- name: "${quoteYAML(name)}"`);
  const keywords = splitList(form.keywords).map((keyword) => `  - "${quoteYAML(keyword)}"`);

  return [
    'cff-version: 1.2.0',
    'message: "If you use this work, please cite it using the metadata below."',
    `title: "${quoteYAML(form.title)}"`,
    'authors:',
    ...(authors.length ? authors : ['- name: ""']),
    `license: "${quoteYAML(form.license)}"`,
    `type: ${form.typeOfWork}`,
    'keywords:',
    ...(keywords.length ? keywords : ['  - ""']),
    'abstract: >-',
    indentBlock(form.abstract || ''),
    '',
  ].join('\n');
}

function toZenodoJson(form) {
  return JSON.stringify(
    {
      title: form.title,
      creators: splitList(form.authors).map((name) => ({ name })),
      license: form.license,
      keywords: splitList(form.keywords),
      upload_type: form.typeOfWork,
      description: form.abstract,
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
