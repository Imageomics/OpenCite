import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { MetadataForm } from './components/MetadataForm.jsx';
import { normalizeMetadata } from './metadata/normalizeMetadata.js';
import { importGithubMetadata } from './services/githubImporter.js';
import { pickPreferredOrcidCandidate, searchOrcidCandidates } from './services/orcidSearch.js';
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

const WARNING_MESSAGE_MAX_LENGTH = 180;

function truncateMessage(message, maxLength = WARNING_MESSAGE_MAX_LENGTH) {
  const normalized = String(message ?? '').replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatWarningCode(code) {
  const value = String(code ?? '').trim();
  if (!value) {
    return 'Warning';
  }

  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatWarningList(warnings) {
  const groups = new Map();

  for (const warning of warnings) {
    const code = String(warning?.code ?? 'warning');
    const shortMessage = truncateMessage(warning?.message ?? 'Warning');
    const group = groups.get(code) ?? {
      code,
      total: 0,
      messages: new Map(),
    };

    group.total += 1;
    group.messages.set(shortMessage, (group.messages.get(shortMessage) ?? 0) + 1);
    groups.set(code, group);
  }

  return [...groups.values()].map((group) => {
    const messageParts = [...group.messages.entries()].map(([message, count]) =>
      count > 1 ? `${message} (${count}x)` : message,
    );

    if (group.total === 1 && messageParts.length === 1) {
      return messageParts[0];
    }

    return `${formatWarningCode(group.code)} (${group.total}): ${messageParts.join(' | ')}`;
  });
}

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
  const [copyState, setCopyState] = useState('idle');
  const [orcidSuggestions, setOrcidSuggestions] = useState({});
  const normalizedForm = useMemo(() => normalizeFormInput(form), [form]);
  const normalizedMetadata = useMemo(() => normalizeMetadata(normalizedForm), [normalizedForm]);
  const validationErrors = useMemo(() => validateMetadata(normalizedForm, typeOptions), [normalizedForm]);
  const warningDisplayList = useMemo(
    () => formatWarningList(importStatus.warnings),
    [importStatus.warnings],
  );

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
    setOrcidSuggestions((current) => {
      const next = {};
      for (const [key, value] of Object.entries(current)) {
        const suggestionIndex = Number(key);
        if (!Number.isInteger(suggestionIndex) || suggestionIndex === index) {
          continue;
        }

        next[suggestionIndex > index ? suggestionIndex - 1 : suggestionIndex] = value;
      }
      return next;
    });
  }

  function reorderAuthor(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= form.authors.length) {
      return;
    }

    setForm((current) => {
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

    setOrcidSuggestions((current) => {
      const next = { ...current };
      const currentIndexValue = next[index];
      next[index] = next[nextIndex];
      next[nextIndex] = currentIndexValue;

      return next;
    });
  }

  async function resolveOrcidSuggestionsForAuthors(nextForm) {
    const authors = Array.isArray(nextForm.authors) ? nextForm.authors : [];
    const nextAuthors = [...authors];
    const nextSuggestions = {};

    for (let index = 0; index < authors.length; index += 1) {
      const author = authors[index];
      if (String(author?.orcid ?? '').trim()) {
        continue;
      }

      if (!String(author?.givenNames ?? '').trim() || !String(author?.familyNames ?? '').trim()) {
        continue;
      }

      try {
        const suggestions = await searchOrcidCandidates(author);
        const preferred = pickPreferredOrcidCandidate(author, suggestions);

        if (preferred) {
          nextAuthors[index] = {
            ...nextAuthors[index],
            orcid: preferred.orcid,
          };
          continue;
        }

        if (suggestions.length > 0) {
          nextSuggestions[index] = {
            loading: false,
            suggestions,
            error: '',
          };
        }
      } catch (error) {
        nextSuggestions[index] = {
          loading: false,
          suggestions: [],
          error: error instanceof Error ? error.message : 'ORCID search failed.',
        };
      }
    }

    return {
      form: {
        ...nextForm,
        authors: nextAuthors,
      },
      suggestions: nextSuggestions,
    };
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
    let nextForm = metadataToForm(result.metadata);
    let nextSuggestions = {};

    if (result.errors.length === 0) {
      const resolved = await resolveOrcidSuggestionsForAuthors(nextForm);
      nextForm = resolved.form;
      nextSuggestions = resolved.suggestions;
    }

    setImportStatus({
      loading: false,
      warnings: result.warnings,
      errors: result.errors,
    });

    if (result.errors.length === 0) {
      setForm(nextForm);
      setOrcidSuggestions(nextSuggestions);
    }
  }

  async function suggestOrcid(index) {
    const author = form.authors[index] ?? {};

    setOrcidSuggestions((current) => ({
      ...current,
      [index]: { loading: true, suggestions: [], error: '' },
    }));

    try {
      const suggestions = await searchOrcidCandidates(author);
      setOrcidSuggestions((current) => ({
        ...current,
        [index]: {
          loading: false,
          suggestions,
          error: suggestions.length > 0 ? '' : 'No ORCID candidates found.',
        },
      }));
    } catch (error) {
      setOrcidSuggestions((current) => ({
        ...current,
        [index]: {
          loading: false,
          suggestions: [],
          error: error instanceof Error ? error.message : 'ORCID search failed.',
        },
      }));
    }
  }

  function applySuggestedOrcid(index, candidate) {
    setForm((current) => ({
      ...current,
      authors: current.authors.map((author, i) => {
        if (i !== index) {
          return author;
        }

        return {
          ...author,
          orcid: candidate.orcid,
        };
      }),
    }));

    setOrcidSuggestions((current) => ({
      ...current,
      [index]: {
        loading: false,
        suggestions: [],
        error: '',
      },
    }));
  }

  function handleDownloadCitation() {
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    if (!confirmMissingCitationReferences(citationPreview)) {
      return;
    }

    downloadFile(CITATION_FILENAME, citationPreview, 'text/yaml;charset=utf-8');
  }

  async function handleDownloadZenodo() {
    if (Object.keys(validationErrors).length > 0) {
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
    if (Object.keys(validationErrors).length > 0) {
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

  async function handleCopyPreview() {
    if (copyState !== 'idle') {
      return;
    }

    const previewText = previewType === 'citation' ? citationPreview : zenodoPreview;

    try {
      setCopyState('copying');

      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard API is unavailable in this browser context.');
      }

      await navigator.clipboard.writeText(previewText);
      setCopyState('copied');
    } catch (error) {
      console.error('Could not copy preview to clipboard:', error);
      setCopyState('error');
    } finally {
      setTimeout(() => {
        setCopyState('idle');
      }, 2000);
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
                    {warningDisplayList.map((message, index) => (
                      <li key={`warning-group-${index}`}>{message}</li>
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
          errors={validationErrors}
          orcidSuggestions={orcidSuggestions}
          updateField={updateField}
          updateAuthorField={updateAuthorField}
          suggestOrcid={suggestOrcid}
          applySuggestedOrcid={applySuggestedOrcid}
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
              <button
                type="button"
                className="secondary"
                onClick={handleCopyPreview}
                disabled={copyState !== 'idle'}
              >
                {copyState === 'copied'
                  ? '✓ Copied!'
                  : copyState === 'error'
                    ? 'Copy failed'
                    : copyState === 'copying'
                      ? 'Copying...'
                      : 'Copy'}
              </button>
            </div>
            <pre>{previewType === 'citation' ? citationPreview : zenodoPreview}</pre>
          </div>
        </div>
      </section>
    </main>
  );
}
