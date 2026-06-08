import { useMemo, useState } from 'react';
import { normalizeMetadata } from './services/metadata';
import { toCitationCff } from './services/citation';
import { toZenodoJson } from './services/zenodo';
import { normalizeFormInput, validateMetadata } from './services/validation';

const initialForm = {
  title: '',
  authors: [{ givenNames: '', familyNames: '', orcid: '', affiliation: '' }],
  license: '',
  keywords: '',
  typeOfWork: 'software',
  customTypeOfWork: '',
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
    const errors = validateMetadata(normalizedForm, typeOptions);

    if (Object.keys(errors).length > 0) {
      alert(Object.values(errors).join('\n'));
      return;
    }

    downloadFile('CITATION.cff', citationPreview, 'text/yaml;charset=utf-8');
  }

  function handleDownloadZenodo() {
    const errors = validateMetadata(normalizedForm, typeOptions);

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
            <strong> zenodo.json</strong>.
          </p>
        </div>

        <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
          <label className="full-width">
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
              <option value="">Select license (SPDX code)</option>
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

          {form.typeOfWork === 'other' && (
            <label>
              <span>Specify type of work</span>
              <input
                name="customTypeOfWork"
                value={form.customTypeOfWork}
                onChange={updateField}
                placeholder="e.g., protocol, poster, thesis"
              />
            </label>
          )}

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
            <span>DOI (version-agnostic, from Zenodo)</span>
            <input name="doi" value={form.doi} onChange={updateField} placeholder="10.0000/zenodo.example.doi" />
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
            <small>One reference per line. Plain text citation format.</small>
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
