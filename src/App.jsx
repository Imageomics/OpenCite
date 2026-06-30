import { useMemo, useState } from 'react';
import { MetadataForm } from './components/MetadataForm.jsx';
import { normalizeMetadata } from './metadata/normalizeMetadata.js';
import { toCitationCff } from './services/citation.js';
import { toZenodoJson } from './services/zenodo.js';
import { normalizeFormInput, validateMetadata } from './validation/validation.js';

function createAuthorId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `author-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createAuthor() {
  return { id: createAuthorId(), givenNames: '', familyNames: '', orcid: '', affiliation: '' };
}

const initialForm = {
  title: '',
  authors: [createAuthor()],
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

const licenseOptions = [
  'MIT',
  'CC0-1.0',
  'CC-BY-4.0',
  'Apache-2.0',
  'BSD-3-Clause',
  'GPL-3.0-only',
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
      authors: [...current.authors, createAuthor()],
    }));
  }

  function removeAuthor(index) {
    setForm((current) => ({
      ...current,
      authors:
        current.authors.length > 1
          ? current.authors.filter((_, i) => i !== index)
          : [createAuthor()],
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

    downloadFile('.zenodo.json', zenodoPreview, 'application/json;charset=utf-8');
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="hero">
          <p className="eyebrow">OpenCite</p>
          <h1>Generate citation metadata from one clean form.</h1>
          <p className="lede">
            Fill in the metadata once, then download both <strong>CITATION.cff</strong> and
            <strong>.zenodo.json</strong>.
          </p>
        </div>

        <MetadataForm
          form={form}
          typeOptions={typeOptions}
          licenseOptions={licenseOptions}
          updateField={updateField}
          updateAuthorField={updateAuthorField}
          addAuthor={addAuthor}
          removeAuthor={removeAuthor}
        />

        <div className="actions">
          <button type="button" onClick={handleDownloadCitation}>
            Generate CITATION.cff
          </button>
          <button type="button" className="secondary" onClick={handleDownloadZenodo}>
            Generate .zenodo.json
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
                .zenodo.json
              </button>
            </div>
            <pre>{previewType === 'citation' ? citationPreview : zenodoPreview}</pre>
          </div>
        </div>
      </section>
    </main>
  );
}
