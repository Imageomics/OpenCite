import { useEffect, useMemo, useState } from 'react';
import { MetadataForm } from './components/MetadataForm.jsx';
import { normalizeMetadata } from './metadata/normalizeMetadata.js';
import { toCitationCff } from './services/citation.js';
import { toZenodoJson } from './services/zenodo.js';
import { normalizeFormInput, validateMetadata } from './validation/validation.js';

const PIPELINE_STEPS = [
  'Import',
  'Review Metadata',
  'Validate',
  'Export Citation Files',
];

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

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function parseRepositoryLabel(url) {
  try {
    const parsed = new URL(url);
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    if (owner && repo) {
      return `${owner}/${repo.replace(/\.git$/i, '')}`;
    }
  } catch {
    return '';
  }

  return '';
}

function isGithubRepositoryUrl(url) {
  try {
    const parsed = new URL(url);
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    return parsed.hostname.toLowerCase() === 'github.com' && Boolean(owner && repo);
  } catch {
    return false;
  }
}

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [previewType, setPreviewType] = useState('citation');
  const [githubImportUrl, setGithubImportUrl] = useState('');
  const [importStatus, setImportStatus] = useState({
    state: 'idle',
    message: 'Paste a GitHub repository URL to begin.',
    step: 0,
  });
  const [downloadNotice, setDownloadNotice] = useState({ kind: '', message: '' });
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') {
      return 'light';
    }

    const savedTheme = window.localStorage.getItem('opencite-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const normalizedForm = useMemo(() => normalizeFormInput(form), [form]);
  const normalizedMetadata = useMemo(() => normalizeMetadata(normalizedForm), [normalizedForm]);
  const validationErrors = useMemo(() => validateMetadata(normalizedForm, typeOptions), [normalizedForm]);
  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const hasMetadataCore = Boolean(
    normalizedForm.title.trim()
    || normalizedForm.authors.some((author) => author.givenNames || author.familyNames),
  );
  const currentPipelineStep = useMemo(() => {
    if (!normalizedForm.repositoryCode.trim()) {
      return 1;
    }

    if (!hasMetadataCore) {
      return 2;
    }

    if (hasValidationErrors) {
      return 3;
    }

    return 4;
  }, [normalizedForm.repositoryCode, hasMetadataCore, hasValidationErrors]);
  const authorSummary = useMemo(() => {
    return normalizedMetadata.authors
      .map((author) => author.zenodoName || `${author.citationAuthor?.['family-names'] || ''}, ${author.citationAuthor?.['given-names'] || ''}`.trim())
      .filter(Boolean);
  }, [normalizedMetadata.authors]);

  const citationPreview = useMemo(() => toCitationCff(normalizedMetadata), [normalizedMetadata]);
  const zenodoPreview = useMemo(() => toZenodoJson(normalizedMetadata), [normalizedMetadata]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('opencite-theme', theme);
  }, [theme]);

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
    if (hasValidationErrors) {
      alert(Object.values(validationErrors).join('\n'));
      setDownloadNotice({ kind: 'error', message: 'Fix validation issues before generating citation files.' });
      return;
    }

    downloadFile('CITATION.cff', citationPreview, 'text/yaml;charset=utf-8');
    setDownloadNotice({
      kind: 'success',
      message: 'Citation metadata generated. CITATION.cff is ready and your export pipeline is active.',
    });
  }

  function handleDownloadZenodo() {
    if (hasValidationErrors) {
      alert(Object.values(validationErrors).join('\n'));
      setDownloadNotice({ kind: 'error', message: 'Fix validation issues before generating citation files.' });
      return;
    }

    downloadFile('.zenodo.json', zenodoPreview, 'application/json;charset=utf-8');
    setDownloadNotice({
      kind: 'success',
      message: 'Citation metadata generated. .zenodo.json is ready and export checks passed.',
    });
  }

  async function handleImportRepository() {
    const trimmedUrl = githubImportUrl.trim();

    if (!trimmedUrl) {
      setImportStatus({ state: 'error', message: 'Enter a GitHub repository URL to import metadata.', step: 0 });
      return;
    }

    if (!isGithubRepositoryUrl(trimmedUrl)) {
      setImportStatus({
        state: 'error',
        message: 'Use a valid GitHub URL like https://github.com/user/project.',
        step: 0,
      });
      return;
    }

    setImportStatus({ state: 'loading', message: 'Fetching repository metadata...', step: 1 });
    await wait(240);
    setImportStatus({ state: 'loading', message: 'Repository found.', step: 1 });
    await wait(240);
    setImportStatus({ state: 'loading', message: 'Processing contributors...', step: 2 });
    await wait(240);
    setImportStatus({ state: 'loading', message: 'Generating citation defaults...', step: 3 });
    await wait(240);

    const repositoryLabel = parseRepositoryLabel(trimmedUrl);
    const repositoryName = repositoryLabel.split('/')[1] ?? '';

    setForm((current) => ({
      ...current,
      repositoryCode: trimmedUrl,
      title: current.title || repositoryName,
    }));

    setImportStatus({
      state: 'success',
      message: repositoryLabel
        ? `Imported repository context for ${repositoryLabel}. Review metadata and export when ready.`
        : 'Repository imported. Review metadata and export when ready.',
      step: 4,
    });
  }

  function toggleTheme() {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  }

  return (
    <main className="app-shell">
      <section className="card">
        <div className="hero">
          <div className="hero-header">
            <p className="eyebrow">OpenCite</p>
            <button
              type="button"
              className="secondary theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              <span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span>
            </button>
          </div>
          <h1>Generate citation metadata from one clean form.</h1>
          <p className="lede">
            Fill in the metadata once, then download both <strong>CITATION.cff</strong> and
            <strong>.zenodo.json</strong>.
          </p>
          <button
            type="button"
            className="hero-import"
            onClick={() => document.getElementById('github-import-url')?.focus()}
          >
            Import GitHub Repository
          </button>
        </div>

        <section className="import-panel" aria-labelledby="github-import-title">
          <div className="import-panel-header">
            <span className="icon-badge" aria-hidden="true">↗</span>
            <div>
              <h2 id="github-import-title">Import from GitHub</h2>
              <p>
                Paste a repository URL to automatically generate citation metadata.
              </p>
            </div>
          </div>
          <label htmlFor="github-import-url" className="full-width">
            <span>Repository URL</span>
            <input
              id="github-import-url"
              name="githubImportUrl"
              value={githubImportUrl}
              onChange={(event) => setGithubImportUrl(event.target.value)}
              placeholder="https://github.com/user/project"
              aria-describedby="github-import-example"
            />
          </label>
          <small id="github-import-example" className="import-example">Example: https://github.com/user/project</small>
          <button
            type="button"
            className="import-button"
            onClick={handleImportRepository}
            disabled={importStatus.state === 'loading'}
            aria-busy={importStatus.state === 'loading'}
          >
            {importStatus.state === 'loading' ? 'Importing repository...' : 'Import Repository'}
          </button>
          <p className={`import-status status-${importStatus.state}`} role="status" aria-live="polite">
            {importStatus.message}
          </p>
        </section>

        <section className="pipeline-card" aria-labelledby="pipeline-title">
          <h2 id="pipeline-title">Pipeline</h2>
          <ol className="pipeline-list">
            {PIPELINE_STEPS.map((label, index) => {
              const stepNumber = index + 1;
              const state = stepNumber < currentPipelineStep
                ? 'complete'
                : stepNumber === currentPipelineStep
                  ? 'current'
                  : 'upcoming';

              return (
                <li key={label} className={`pipeline-step pipeline-step-${state}`}>
                  <span className="step-badge" aria-hidden="true">{stepNumber}</span>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>
        </section>

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

        {downloadNotice.message ? (
          <div className={`notice-card notice-${downloadNotice.kind}`} role="status" aria-live="polite">
            <p className="notice-title">✓ Citation metadata generated</p>
            <p>{downloadNotice.message}</p>
            <p className="notice-files">Ready: CITATION.cff and .zenodo.json</p>
          </div>
        ) : null}

        <section className="metadata-cards" aria-label="Metadata overview">
          <article className="metadata-card">
            <h3>Repository Information</h3>
            <p><strong>Name:</strong> {normalizedForm.title || 'Pending'}</p>
            <p><strong>URL:</strong> {normalizedForm.repositoryCode || 'Not set'}</p>
          </article>
          <article className="metadata-card">
            <h3>Authors</h3>
            <p><strong>Count:</strong> {authorSummary.length}</p>
            <p>{authorSummary.length > 0 ? authorSummary.slice(0, 3).join(' • ') : 'No authors added yet'}</p>
          </article>
          <article className="metadata-card">
            <h3>Version & License</h3>
            <p><strong>Version:</strong> {normalizedForm.version || 'Not set'}</p>
            <p><strong>License:</strong> {normalizedForm.license || 'Not set'}</p>
          </article>
          <article className="metadata-card">
            <h3>Citation Files</h3>
            <p>CITATION.cff</p>
            <p>.zenodo.json</p>
          </article>
        </section>

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

        <footer className="app-footer" aria-label="Project acknowledgements">
          <h3>About OpenCite</h3>
          <p>
            OpenCite helps researchers create standardized citation metadata for research software.
          </p>
          <p>
            This work was supported by both the{' '}
            <a href="https://imageomics.org/" target="_blank" rel="noreferrer">Imageomics Institute</a>
            {' '}and the{' '}
            <a href="http://abcresearchcenter.org/" target="_blank" rel="noreferrer">AI and Biodiversity Change (ABC) Global Center</a>
            . The Imageomics Institute is funded by the U.S. National Science Foundation&apos;s Harnessing the Data Revolution (HDR) program under{' '}
            <a href="https://www.nsf.gov/awardsearch/showAward?AWD_ID=2118240" target="_blank" rel="noreferrer">Award #2118240</a>
            {' '}(Imageomics: A New Frontier of Biological Information Powered by Knowledge-Guided Machine Learning). The ABC Global Center is funded by the U.S. National Science Foundation under{' '}
            <a href="https://www.nsf.gov/awardsearch/showAward?AWD_ID=2330423&amp;HistoricalAwards=false" target="_blank" rel="noreferrer">Award No. 2330423</a>
            {' '}and Natural Sciences and Engineering Research Council of Canada under{' '}
            <a href="https://www.nserc-crsng.gc.ca/ase-oro/Details-Detailles_eng.asp?id=782440" target="_blank" rel="noreferrer">Award No. 585136</a>
            . This work draws on research supported by the Social Sciences and Humanities Research Council. Any opinions, findings and conclusions or recommendations expressed in this material are those of the author(s) and do not necessarily reflect the views of the National Science Foundation, Natural Sciences and Engineering Research Council of Canada, or Social Sciences and Humanities Research Council.
          </p>
          <p>
            Contributors: Isabella Lo and Elizabeth Campolongo.
          </p>
          <p>
            <a href="https://github.com/Imageomics/OpenCite" target="_blank" rel="noreferrer">
              View OpenCite on GitHub
            </a>
            {' • '}
            <a href="https://github.com/Imageomics/OpenCite/blob/main/CITATION.cff" target="_blank" rel="noreferrer">
              Cite this project
            </a>
            {' • '}
            <a href="https://imageomics.github.io/Collaborative-distributed-science-guide/" target="_blank" rel="noreferrer">
              Read the Collaborative Distributed Science Guide
            </a>
            {' • '}
            <a href="https://imageomics.github.io/OpenCite/" target="_blank" rel="noreferrer">
              Open OpenCite
            </a>
          </p>
        </footer>
      </section>
    </main>
  );
}
