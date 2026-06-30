import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { MetadataForm } from './components/MetadataForm.jsx';
import { normalizeMetadata } from './metadata/normalizeMetadata.js';
import { importGithubMetadata } from './services/githubImporter.js';
import { toCitationCff } from './services/citation.js';
import { toZenodoJson } from './services/zenodo.js';
import { normalizeFormInput, validateMetadata } from './validation/validation.js';

const CITATION_FILENAME = 'CITATION.cff';
const ZENODO_FILENAME = '.zenodo.json';
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

function createBlankAuthor() {
  return { givenNames: '', familyNames: '', orcid: '', affiliation: '' };
}

function metadataToForm(metadata) {
  return {
    title: String(metadata.title ?? ''),
    authors:
      Array.isArray(metadata.authors) && metadata.authors.length > 0
        ? metadata.authors.map((author) => ({
            givenNames: String(author.givenNames ?? ''),
            familyNames: String(author.familyNames ?? ''),
            orcid: String(author.orcid ?? ''),
            affiliation: String(author.affiliation ?? ''),
          }))
        : [createBlankAuthor()],
    license: String(metadata.license ?? ''),
    keywords: Array.isArray(metadata.keywords) ? metadata.keywords.join(', ') : '',
    typeOfWork: String(metadata.typeOfWork ?? 'software'),
    customTypeOfWork: String(metadata.customTypeOfWork ?? ''),
    version: String(metadata.version ?? ''),
    publicationDate: String(metadata.publicationDate ?? ''),
    repositoryCode: String(metadata.repositoryCode ?? ''),
    doi: String(metadata.doi ?? ''),
    abstract: String(metadata.abstract ?? ''),
    references: Array.isArray(metadata.references) ? metadata.references.join('\n') : '',
    grants: Array.isArray(metadata.grants) ? metadata.grants.join('\n') : '',
  };
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

function confirmMissingCitationReferences(citationText) {
  const hasReferencesSection = /^references:\s*$/m.test(String(citationText ?? ''));
  if (hasReferencesSection) {
    return true;
  }

  const message = 'CITATION.cff currently has no references section. Continue export anyway?';

  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(message);
  }

  return true;
}

async function saveFileWithPicker(filename, content, mimeType, pickerTypes = []) {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: pickerTypes,
      });
      const writable = await fileHandle.createWritable();
      const data = content instanceof Blob ? content : new Blob([content], { type: mimeType });
      await writable.write(data);
      await writable.close();
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return false;
      }
    }
  }

  downloadFile(filename, content, mimeType);
  return true;
}

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [githubUrl, setGithubUrl] = useState('');
  const [importStatus, setImportStatus] = useState({ loading: false, warnings: [], errors: [] });
  const [isZipping, setIsZipping] = useState(false);
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

  function reorderAuthor(index, direction) {
    setForm((current) => {
      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex >= current.authors.length) {
        return current;
      }

      const authors = [...current.authors];
      [authors[index], authors[nextIndex]] = [authors[nextIndex], authors[index]];

      return {
        ...current,
        authors,
      };
    });
  }

  async function handleImportGithubMetadata() {
    const repoUrl = githubUrl.trim();

    if (!repoUrl) {
      setImportStatus({
        loading: false,
        warnings: [],
        errors: [{ kind: 'error', source: 'ui', code: 'empty-url', message: 'Paste a GitHub repository URL first.' }],
      });
      return;
    }

    setImportStatus({ loading: true, warnings: [], errors: [] });

    const result = await importGithubMetadata(repoUrl);

    setImportStatus({
      loading: false,
      warnings: result.warnings,
      errors: result.errors,
    });

    if (result.errors.length === 0) {
      setForm(metadataToForm(result.metadata));
    }
  }

  function handleDownloadCitation() {
    const errors = validateMetadata(normalizedForm, typeOptions);

    if (Object.keys(errors).length > 0) {
      alert(Object.values(errors).join('\n'));
      return;
    }

    if (!confirmMissingCitationReferences(citationPreview)) {
      return;
    }

    downloadFile(CITATION_FILENAME, citationPreview, 'text/yaml;charset=utf-8');
  }

  async function handleDownloadZenodo() {
    const errors = validateMetadata(normalizedForm, typeOptions);

    if (Object.keys(errors).length > 0) {
      alert(Object.values(errors).join('\n'));
      return;
    }

    await saveFileWithPicker(
      ZENODO_FILENAME,
      zenodoPreview,
      'application/json;charset=utf-8',
      [{ description: 'Zenodo metadata', accept: { 'application/json': ['.json'] } }],
    );
  }

  async function handleDownloadZip() {
    const errors = validateMetadata(normalizedForm, typeOptions);

    if (Object.keys(errors).length > 0) {
      alert(Object.values(errors).join('\n'));
      return;
    }

    if (!confirmMissingCitationReferences(citationPreview)) {
      return;
    }

    setIsZipping(true);

    try {
      const zip = new JSZip();
      zip.file(CITATION_FILENAME, citationPreview);
      zip.file(ZENODO_FILENAME, zenodoPreview);

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const safeTitle = String(normalizedForm.title || 'opencite-metadata')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'opencite-metadata';

      downloadFile(`${safeTitle}.zip`, zipBlob, 'application/zip');
    } catch (error) {
      alert(`Could not create ZIP file: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsZipping(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="hero">
          <p className="eyebrow">OpenCite</p>
          <h1>Generate citation metadata from one clean form.</h1>
          <p className="lede">
            Fill in the metadata once, then download both <strong>CITATION.cff</strong> and
            <strong> .zenodo.json</strong>.
          </p>
        </div>

        <div className="import-panel full-width">
          <label>
            <span>Import from GitHub repository</span>
            <input
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.target.value)}
              placeholder="https://github.com/imageomics/OpenCite"
            />
          </label>
          <div className="actions">
            <button type="button" onClick={handleImportGithubMetadata} disabled={importStatus.loading}>
              {importStatus.loading ? 'Importing…' : 'Import GitHub metadata'}
            </button>
          </div>
          {(importStatus.errors.length > 0 || importStatus.warnings.length > 0) && (
            <div className="import-feedback">
              {importStatus.errors.length > 0 && (
                <div className="feedback-block feedback-error">
                  <strong>Import errors</strong>
                  <ul>
                    {importStatus.errors.map((entry, index) => (
                      <li key={`error-${entry.code}-${index}`}>{entry.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {importStatus.warnings.length > 0 && (
                <div className="feedback-block feedback-warning">
                  <strong>Import warnings</strong>
                  <ul>
                    {importStatus.warnings.map((entry, index) => (
                      <li key={`warning-${entry.code}-${index}`}>{entry.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <MetadataForm
          form={form}
          typeOptions={typeOptions}
          licenseOptions={licenseOptions}
          updateField={updateField}
          updateAuthorField={updateAuthorField}
          reorderAuthor={reorderAuthor}
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
          <button type="button" className="secondary" onClick={handleDownloadZip} disabled={isZipping}>
            {isZipping ? 'Creating ZIP…' : 'Download ZIP (Both Files)'}
          </button>
        </div>
        <p className="filename-note">
          Note: Some file browsers may hide extensions or leading dots. The exported Zenodo filename is
          <strong> .zenodo.json</strong>.
        </p>

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
