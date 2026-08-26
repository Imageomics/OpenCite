import { useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { MetadataForm } from './components/MetadataForm.jsx';
import { normalizeMetadata } from './metadata/normalizeMetadata.js';
import { importGithubMetadata } from './services/githubImporter.js';
import { pickPreferredOrcidCandidate, searchOrcidCandidates } from './services/orcidSearch.js';
import { toCitationCff } from './services/citation.js';
import { validateCitationCffText } from './services/citationValidation.js';
import { toZenodoJson } from './services/zenodo.js';
import { validateZenodoJsonText } from './services/zenodoValidation.js';
import { hasMeaningfulMetadataValues, normalizeFormInput, validateMetadata } from './validation/validation.js';

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
  version: '0.1.0',
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

const grantSuggestions = [
  {
    id: '021nxhr62::2118240',
    label: 'Imageomics NSF grant',
    note: 'Imageomics program grant (NSF funder code 021nxhr62).',
  },
  {
    id: '021nxhr62::2330423',
    label: 'ABC NSF grant',
    note: 'ABC NSF grant; NSERC portion requires manual update when applicable.',
  },
];

const REQUIRED_FIELD_LABELS = {
  title: 'Title',
  authors: 'Authors',
  license: 'License',
  typeOfWork: 'Type',
  version: 'Version',
  publicationDate: 'Publication date',
  grants: 'Grants',
};

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

function formatReviewStatus(value) {
  const status = String(value ?? '').toLowerCase();

  if (status === 'correct') return 'Correct';
  if (status === 'missing') return 'Missing';
  if (status === 'outdated') return 'Outdated';
  if (status === 'invalid') return 'Invalid';
  return 'Review';
}

function formatReviewAction(value) {
  const action = String(value ?? '').trim();

  if (action === 'keep-file') return 'Keep file';
  if (action === 'update-field') return 'Update field';
  if (action === 'generate-file') return 'Generate file';
  if (action === 'regenerate-file') return 'Regenerate file';
  return 'Review';
}

function formatHealthStatus(value) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'pass') return 'PASS';
  if (status === 'warning') return 'WARNING';
  if (status === 'error') return 'ERROR';
  return 'CHECK';
}

function healthBadgeClass(value) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'pass') return 'health-badge health-badge-pass';
  if (status === 'warning') return 'health-badge health-badge-warning';
  if (status === 'error') return 'health-badge health-badge-error';
  return 'health-badge';
}

function formatComparisonStatus(value) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'identical') return 'IDENTICAL';
  if (status === 'different') return 'DIFFERENT';
  if (status === 'missing') return 'MISSING';
  if (status === 'cannot determine') return 'CANNOT DETERMINE';
  return 'UNKNOWN';
}

function summarizeComparisonIssue(item) {
  if (!item) {
    return '';
  }

  const fieldLabel = String(item.field ?? '').replace(/_/g, ' ');
  if (item.status === 'different') {
    return `${fieldLabel} is outdated`;
  }

  if (item.status === 'missing') {
    return `${fieldLabel} is missing`;
  }

  if (item.status === 'cannot determine') {
    return `${fieldLabel} cannot be determined from GitHub metadata`;
  }

  return '';
}

function buildImportReviewSummary(importStatus) {
  const warnings = [];
  const recommendations = [];

  const healthIssues = (importStatus.healthScan || []).filter((check) => check.status === 'warning' || check.status === 'error');
  for (const issue of healthIssues) {
    const text = String(issue.description || '').trim();
    if (text) {
      warnings.push(text);
    }

    const recommendation = String(issue.recommendation || '').trim();
    if (recommendation) {
      recommendations.push(recommendation);
    }
  }

  const comparisonIssues = (importStatus.comparisons || []).filter((item) => item.status !== 'identical');
  for (const issue of comparisonIssues) {
    const text = summarizeComparisonIssue(issue);
    if (text) {
      warnings.push(text);
    }

    const recommendation = String(issue.recommendation || '').trim();
    if (recommendation) {
      recommendations.push(recommendation);
    }
  }

  const uniqueWarnings = [...new Set(warnings)].filter(Boolean);
  const uniqueRecommendations = [...new Set(recommendations)].filter(Boolean);
  const healthy = uniqueWarnings.length === 0 && (importStatus.errors || []).length === 0;

  return {
    healthy,
    warningCount: uniqueWarnings.length,
    warnings: uniqueWarnings,
    recommendations: uniqueRecommendations,
  };
}

function formatValidationSummary(errors) {
  return Object.entries(errors)
    .map(([key, value]) => {
      if (key === 'authorOrcid' && value && typeof value === 'object') {
        const firstEntry = Object.values(value)[0];
        return firstEntry ? `Author ORCID: ${firstEntry}` : 'Author ORCID: fix the highlighted ORCID fields.';
      }

      if (key === 'authors') {
        return value;
      }

      if (REQUIRED_FIELD_LABELS[key]) {
        return `${REQUIRED_FIELD_LABELS[key]}: ${value}`;
      }

      return value;
    })
    .filter(Boolean);
}

function getValidationMissingFields(errors) {
  const fields = [];

  if (errors.title) fields.push('Title');
  if (errors.authors) fields.push('Authors');
  if (errors.license) fields.push('License');
  if (errors.typeOfWork) fields.push('Type');
  if (errors.version) fields.push('Version');
  if (errors.publicationDate) fields.push('Publication date');
  if (errors.grants) fields.push('Grants');

  if (errors.authorOrcid && typeof errors.authorOrcid === 'object') {
    fields.push('Author ORCID');
  }

  return fields;
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
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1500);
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

function canUseNativeFilePicker() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

async function createMetadataZipBlob(citationPreview, zenodoPreview, validationReport) {
  const zip = new JSZip();
  zip.file(CITATION_FILENAME, citationPreview);
  zip.file(ZENODO_FILENAME, zenodoPreview);
  zip.file('METADATA_VALIDATION.txt', validationReport);

  return zip.generateAsync({ type: 'blob' });
}

async function saveFileWithPicker(filename, content, mimeType, pickerTypes = []) {
  if (canUseNativeFilePicker()) {
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
  const [activePage, setActivePage] = useState('generator');
  const [form, setForm] = useState(initialForm);
  const [githubUrl, setGithubUrl] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [importStatus, setImportStatus] = useState({ loading: false, warnings: [], errors: [], review: null, healthScan: [], comparisons: [] });
  const [isZipping, setIsZipping] = useState(false);
  const [isDownloadingCitation, setIsDownloadingCitation] = useState(false);
  const [isDownloadingZenodo, setIsDownloadingZenodo] = useState(false);
  const [previewType, setPreviewType] = useState('citation');
  const [copyState, setCopyState] = useState('idle');
  const [orcidSuggestions, setOrcidSuggestions] = useState({});
  const [exportNotice, setExportNotice] = useState({ kind: '', message: '', details: [] });
  const [touchedFields, setTouchedFields] = useState({});
  const [hasImportedMetadata, setHasImportedMetadata] = useState(false);
  const importRequestIdRef = useRef(0);
  const normalizedForm = useMemo(() => normalizeFormInput(form), [form]);
  const normalizedMetadata = useMemo(() => normalizeMetadata(normalizedForm), [normalizedForm]);
  const validationErrors = useMemo(() => validateMetadata(normalizedForm, typeOptions), [normalizedForm]);
  const warningDisplayList = useMemo(
    () => formatWarningList(importStatus.warnings),
    [importStatus.warnings],
  );
  const healthScanSummary = useMemo(() => {
    const counts = { pass: 0, warning: 0, error: 0 };
    for (const check of importStatus.healthScan) {
      const status = String(check?.status ?? '').toLowerCase();
      if (status === 'pass' || status === 'warning' || status === 'error') {
        counts[status] += 1;
      }
    }
    return counts;
  }, [importStatus.healthScan]);
  const healthPassChecks = useMemo(
    () => importStatus.healthScan.filter((check) => String(check?.status ?? '').toLowerCase() === 'pass'),
    [importStatus.healthScan],
  );
  const healthWarningChecks = useMemo(
    () => importStatus.healthScan.filter((check) => String(check?.status ?? '').toLowerCase() === 'warning'),
    [importStatus.healthScan],
  );
  const healthErrorChecks = useMemo(
    () => importStatus.healthScan.filter((check) => String(check?.status ?? '').toLowerCase() === 'error'),
    [importStatus.healthScan],
  );
  const importReviewSummary = useMemo(
    () => buildImportReviewSummary(importStatus),
    [importStatus],
  );

  const citationPreview = useMemo(() => toCitationCff(normalizedMetadata), [normalizedMetadata]);
  const zenodoPreview = useMemo(() => toZenodoJson(normalizedMetadata), [normalizedMetadata]);
  const citationValidation = useMemo(
    () => validateCitationCffText(citationPreview),
    [citationPreview],
  );
  const zenodoValidation = useMemo(
    () => validateZenodoJsonText(zenodoPreview),
    [zenodoPreview],
  );

  const metadataValidationReport = useMemo(
    () => [citationValidation.report, '', zenodoValidation.report].join('\n'),
    [citationValidation.report, zenodoValidation.report],
  );

  function showValidationNotice(errors) {
    const details = formatValidationSummary(errors);
    const missingFields = getValidationMissingFields(errors);
    setExportNotice({
      kind: 'validation',
      message: missingFields.length > 0
        ? `Missing or invalid fields: ${missingFields.join(', ')}.`
        : 'Some required values are missing or invalid. Review the highlighted fields below.',
      details: details.length > 0 ? details : ['Review the highlighted fields below.'],
    });

    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function clearExportNotice() {
    setExportNotice({ kind: '', message: '', details: [] });
  }

  function openReviewedMetadataInGenerator() {
    setActivePage('generator');

    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function renderHealthCheckCard(check, key) {
    return (
      <li key={key} className="health-item">
        <div className="health-item-header">
          <span className={healthBadgeClass(check.status)}>{formatHealthStatus(check.status)}</span>
          <strong>{check.title}</strong>
        </div>
        <p className="health-item-description">{check.description}</p>
        {check.recommendation ? (
          <p className="health-item-recommendation">
            <span>Recommendation:</span> {check.recommendation}
          </p>
        ) : null}
      </li>
    );
  }

  async function downloadCitationFile() {
    downloadFile(CITATION_FILENAME, citationPreview, 'text/yaml;charset=utf-8');
  }

  async function downloadZenodoFile() {
    // Use direct download to preserve the exact leading-dot filename `.zenodo.json`.
    downloadFile(ZENODO_FILENAME, zenodoPreview, 'application/json;charset=utf-8');
  }

  function updateField(event) {
    const { name, value } = event.target;
    setTouchedFields((current) => ({ ...current, [name]: true }));
    setForm((current) => ({ ...current, [name]: value }));
  }

  function appendGrantSuggestion(grantId) {
    const normalizedGrantId = String(grantId ?? '').trim();
    if (!normalizedGrantId) {
      return;
    }

    setForm((current) => {
      const existing = String(current.grants ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (existing.includes(normalizedGrantId)) {
        return current;
      }

      return {
        ...current,
        grants: [...existing, normalizedGrantId].join('\n'),
      };
    });
  }

  function appendAllGrantSuggestions() {
    setForm((current) => {
      const existing = new Set(
        String(current.grants ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      );

      for (const suggestion of grantSuggestions) {
        existing.add(suggestion.id);
      }

      return {
        ...current,
        grants: [...existing].join('\n'),
      };
    });
  }

  function updateAuthorField(index, field, value) {
    setTouchedFields((current) => ({
      ...current,
      authors: true,
      [`authors.${index}.${field}`]: true,
    }));
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
        review: null,
        healthScan: [],
        comparisons: [],
        errors: [{ kind: 'error', source: 'ui', code: 'empty-url', message: 'Paste a GitHub repository URL first.' }],
      });
      return;
    }

    setImportStatus({ loading: true, warnings: [], errors: [], review: null, healthScan: [], comparisons: [] });
    const requestId = importRequestIdRef.current + 1;
    importRequestIdRef.current = requestId;

    try {
      const result = await importGithubMetadata(repoUrl, {
        contributorFallbackLimit: 5,
        authToken: githubToken.trim(),
      });

      if (importRequestIdRef.current !== requestId) {
        return;
      }

      let nextForm = metadataToForm(result.metadata);
      let nextSuggestions = {};
      const importedMeaningfulMetadata = hasMeaningfulMetadataValues(nextForm);

      if (result.errors.length === 0 && importedMeaningfulMetadata) {
        const resolved = await resolveOrcidSuggestionsForAuthors(nextForm);
        nextForm = resolved.form;
        nextSuggestions = resolved.suggestions;
      }

      if (importRequestIdRef.current !== requestId) {
        return;
      }

      if (!importedMeaningfulMetadata) {
        setTouchedFields((current) => ({
          ...current,
          title: true,
          authors: true,
          license: true,
          version: true,
          typeOfWork: true,
          publicationDate: true,
        }));
      }

      setImportStatus({
        loading: false,
        warnings: result.warnings,
        errors: result.errors,
        review: importedMeaningfulMetadata ? (result.review || null) : null,
        healthScan: importedMeaningfulMetadata ? (Array.isArray(result.healthScan) ? result.healthScan : []) : [],
        comparisons: importedMeaningfulMetadata ? (Array.isArray(result.comparisons) ? result.comparisons : []) : [],
      });

      setHasImportedMetadata(importedMeaningfulMetadata);

      if (result.errors.length === 0) {
        setForm(nextForm);
        setOrcidSuggestions(nextSuggestions);
      }
    } catch (error) {
      if (importRequestIdRef.current !== requestId) {
        return;
      }

      setImportStatus({
        loading: false,
        warnings: [],
        review: null,
        healthScan: [],
        comparisons: [],
        errors: [{
          kind: 'error',
          source: 'import',
          code: 'import-failed',
          message: error instanceof Error ? error.message : 'GitHub import failed unexpectedly.',
        }],
      });
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
      showValidationNotice(validationErrors);
      return;
    }

    if (!citationValidation.isValid) {
      setExportNotice({
        kind: 'validation',
        message: 'Cannot export CITATION.cff until validation issues are fixed.',
        details: citationValidation.errors,
      });
      return;
    }

    if (!confirmMissingCitationReferences(citationPreview)) {
      return;
    }

    clearExportNotice();
    setIsDownloadingCitation(true);
    downloadCitationFile();
    setTimeout(() => {
      setIsDownloadingCitation(false);
    }, 500);
  }

  async function handleDownloadZenodo() {
    if (Object.keys(validationErrors).length > 0) {
      showValidationNotice(validationErrors);
      return;
    }

    if (!zenodoValidation.isValid) {
      setExportNotice({
        kind: 'validation',
        message: 'Cannot export .zenodo.json until validation issues are fixed.',
        details: zenodoValidation.errors,
      });
      return;
    }

    clearExportNotice();
    setIsDownloadingZenodo(true);

    try {
      await downloadZenodoFile();
    } finally {
      setTimeout(() => setIsDownloadingZenodo(false), 500);
    }
  }

  async function handleDownloadZip() {
    if (Object.keys(validationErrors).length > 0) {
      showValidationNotice(validationErrors);
      return;
    }

    if (!citationValidation.isValid) {
      setExportNotice({
        kind: 'validation',
        message: 'Cannot create ZIP until CITATION.cff validation issues are fixed.',
        details: citationValidation.errors,
      });
      return;
    }

    if (!zenodoValidation.isValid) {
      setExportNotice({
        kind: 'validation',
        message: 'Cannot create ZIP until .zenodo.json validation issues are fixed.',
        details: zenodoValidation.errors,
      });
      return;
    }

    if (!confirmMissingCitationReferences(citationPreview)) {
      return;
    }

    clearExportNotice();
    setIsZipping(true);

    try {
      const zipBlob = await createMetadataZipBlob(
        citationPreview,
        zenodoPreview,
        metadataValidationReport,
      );
      const safeTitle = String(normalizedForm.title || 'opencite-metadata')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'opencite-metadata';

      if (canUseNativeFilePicker()) {
        const saved = await saveFileWithPicker(
          `${safeTitle}.zip`,
          zipBlob,
          'application/zip',
          [{ description: 'OpenCite metadata ZIP', accept: { 'application/zip': ['.zip'] } }],
        );

        if (saved) {
          return;
        }
      }

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
          <h1>{activePage === 'generator' ? 'Generate citation metadata from one clean form.' : 'Run a citation health review for any GitHub repository.'}</h1>
          <p className="lede">
            {activePage === 'generator'
              ? (
                <>
                  Fill in the metadata once, then download both <strong>CITATION.cff</strong> and
                  <strong> .zenodo.json</strong>.
                </>
              )
              : 'Analyze existing repository metadata and get actionable recommendations before deciding what to update or regenerate.'}
          </p>
        </div>

        <div className="page-tabs" role="tablist" aria-label="OpenCite pages">
          <button
            type="button"
            role="tab"
            aria-selected={activePage === 'generator'}
            className={activePage === 'generator' ? 'tab-active' : 'secondary'}
            onClick={() => setActivePage('generator')}
          >
            Metadata Generator
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePage === 'review'}
            className={activePage === 'review' ? 'tab-active' : 'secondary'}
            onClick={() => setActivePage('review')}
          >
            Citation Health Review
          </button>
        </div>

        <section className="learn-more-panel" aria-label="Citation and release resources">
          <h2>Learn More</h2>
          <p>
            Reference these guides while preparing release metadata and citation files.
          </p>
          <ul>
            <li>
              <a
                href="https://force11.org/info/software-citation-principles/"
                target="_blank"
                rel="noreferrer"
              >
                Software citation practices (FORCE11 principles)
              </a>
            </li>
            <li>
              <a
                href="https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository"
                target="_blank"
                rel="noreferrer"
              >
                GitHub release workflow
              </a>
            </li>
            <li>
              <a
                href="https://help.zenodo.org/docs/github/"
                target="_blank"
                rel="noreferrer"
              >
                Zenodo GitHub integration guide
              </a>
            </li>
            <li>
              <a
                href="https://github.com/citation-file-format/citation-file-format/blob/main/schema-guide.md"
                target="_blank"
                rel="noreferrer"
              >
                Citation File Format schema guide
              </a>
            </li>
          </ul>
        </section>

        {activePage === 'generator' && exportNotice.kind === 'validation' && (
          <div className="export-notice export-notice-warning" role="alert" aria-live="polite">
            <strong>{exportNotice.message}</strong>
            {exportNotice.details.length > 0 && (
              <ul>
                {exportNotice.details.slice(0, 5).map((detail, index) => (
                  <li key={`${detail}-${index}`}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activePage === 'generator' && importStatus.healthScan.length > 0 && (
          <div className="export-notice export-notice-info" role="status" aria-live="polite">
            <strong>Reviewed metadata loaded in editor.</strong>
            <ul>
              <li>Warnings: {healthScanSummary.warning}</li>
              <li>Passing checks: {healthScanSummary.pass}</li>
              <li>Errors: {healthScanSummary.error}</li>
            </ul>
          </div>
        )}

        {activePage === 'generator' && (
          <div className="import-panel compact-import full-width">
            <label>
              <span>Import metadata from GitHub repository</span>
              <input
                value={githubUrl}
                onChange={(event) => setGithubUrl(event.target.value)}
                placeholder="https://github.com/imageomics/OpenCite"
              />
            </label>
            <label>
              <span>GitHub token (optional)</span>
              <input
                type="password"
                value={githubToken}
                onChange={(event) => setGithubToken(event.target.value)}
                placeholder="For higher GitHub API limits"
                autoComplete="off"
              />
            </label>
            <p className="import-note">
              Use a fine-grained token with public repository read access for higher API limits. This works even when the repository does not have a <strong>CITATION.cff</strong> file.
            </p>
            <div className="actions">
              <button type="button" onClick={handleImportGithubMetadata} disabled={importStatus.loading}>
                {importStatus.loading ? 'Importing…' : 'Import GitHub metadata'}
              </button>
              <button type="button" className="secondary" onClick={() => setActivePage('review')}>
                Open Full Citation Review
              </button>
            </div>
            {(importStatus.errors.length > 0 || importStatus.warnings.length > 0) && (
              <div className="import-feedback">
                {importStatus.errors.length > 0 && (
                  <div className="feedback-block feedback-error">
                    <strong>Import errors</strong>
                    <ul>
                      {importStatus.errors.map((entry, index) => (
                        <li key={`generator-error-${entry.code}-${index}`}>{entry.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {importStatus.warnings.length > 0 && (
                  <div className="feedback-block feedback-warning">
                    <strong>Import warnings</strong>
                    <ul>
                      {warningDisplayList.map((message, index) => (
                        <li key={`generator-warning-${index}`}>{message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activePage === 'review' && (
          <div className="import-panel full-width">
          <label>
            <span>Import from GitHub repository</span>
            <input
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.target.value)}
              placeholder="https://github.com/imageomics/OpenCite"
            />
          </label>
          <label>
            <span>GitHub token (optional)</span>
            <input
              type="password"
              value={githubToken}
              onChange={(event) => setGithubToken(event.target.value)}
              placeholder="For higher GitHub API limits"
              autoComplete="off"
            />
          </label>
          <div className="actions">
            <button type="button" onClick={handleImportGithubMetadata} disabled={importStatus.loading}>
              {importStatus.loading ? 'Importing…' : 'Import GitHub metadata'}
            </button>
          </div>
          {(importStatus.errors.length > 0 || importStatus.warnings.length > 0 || importStatus.review || importStatus.healthScan.length > 0 || importStatus.comparisons.length > 0) && (
            <div className="import-feedback">
              <div className="feedback-block feedback-summary">
                <strong>Citation Review</strong>
                <p className="review-summary">
                  {importReviewSummary.healthy
                    ? '✓ Repository metadata looks healthy'
                    : `Warnings (${importReviewSummary.warningCount})`}
                </p>
                {importReviewSummary.warnings.length > 0 && (
                  <ul>
                    {importReviewSummary.warnings.map((item, index) => (
                      <li key={`summary-warning-${index}`}>{item}</li>
                    ))}
                  </ul>
                )}
                {importReviewSummary.recommendations.length > 0 && (
                  <>
                    <p className="review-summary">Recommendations</p>
                    <ul>
                      {importReviewSummary.recommendations.map((item, index) => (
                        <li key={`summary-recommendation-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
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
              {importStatus.review && (
                <div className="feedback-block feedback-review">
                  <strong>Metadata review</strong>
                  <p className="review-summary">
                    Correct: {importStatus.review.summary?.byStatus?.correct ?? 0} | Missing: {importStatus.review.summary?.byStatus?.missing ?? 0} | Outdated: {importStatus.review.summary?.byStatus?.outdated ?? 0} | Invalid: {importStatus.review.summary?.byStatus?.invalid ?? 0}
                  </p>
                  {Array.isArray(importStatus.review.recommendations?.actions) && importStatus.review.recommendations.actions.length > 0 && (
                    <ul>
                      {importStatus.review.recommendations.actions.map((action, index) => (
                        <li key={`review-action-${index}`}>{action}</li>
                      ))}
                    </ul>
                  )}
                  {Array.isArray(importStatus.review.findings) && importStatus.review.findings.length > 0 && (
                    <ul>
                      {importStatus.review.findings.map((finding, index) => (
                        <li key={`review-finding-${finding.id || index}`}>
                          [{formatReviewStatus(finding.status)} | {formatReviewAction(finding.action)}]
                          {finding.file ? ` ${finding.file}:` : ''} {finding.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {importStatus.healthScan.length > 0 && (
                <div className="feedback-block feedback-health">
                  <strong>Citation health scan</strong>
                  <p className="review-summary">
                    Passing checks: {healthScanSummary.pass} | Warnings to review: {healthScanSummary.warning} | Errors to fix: {healthScanSummary.error}
                  </p>
                  <div className="actions">
                    <button type="button" onClick={openReviewedMetadataInGenerator}>
                      Open Reviewed Metadata In Editor
                    </button>
                  </div>

                  {healthErrorChecks.length > 0 && (
                    <div className="health-group">
                      <h3>Errors (Fix first)</h3>
                      <ul className="health-list">
                        {healthErrorChecks.map((check, index) => renderHealthCheckCard(check, `health-error-${index}`))}
                      </ul>
                    </div>
                  )}

                  {healthWarningChecks.length > 0 && (
                    <div className="health-group">
                      <h3>Warnings (Recommended updates)</h3>
                      <ul className="health-list">
                        {healthWarningChecks.map((check, index) => renderHealthCheckCard(check, `health-warning-${index}`))}
                      </ul>
                    </div>
                  )}

                  {healthPassChecks.length > 0 && (
                    <div className="health-group">
                      <h3>Done Well</h3>
                      <ul className="health-list">
                        {healthPassChecks.map((check, index) => renderHealthCheckCard(check, `health-pass-${index}`))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {importStatus.comparisons.length > 0 && (
                <div className="feedback-block feedback-comparison">
                  <strong>Field-by-field comparison (existing files vs live GitHub metadata)</strong>
                  <ul className="comparison-list">
                    {importStatus.comparisons.map((item, index) => (
                      <li key={`comparison-${item.file}-${item.field}-${index}`} className="comparison-item">
                        <div className="comparison-header">
                          <strong>{item.file} - {item.field}</strong>
                          <span className="comparison-status">{formatComparisonStatus(item.status)}</span>
                        </div>
                        <p><span>Current:</span> {item.currentValue || '(missing)'}</p>
                        <p><span>GitHub:</span> {item.githubValue || '(cannot determine)'}</p>
                        <p><span>Recommendation:</span> {item.recommendation}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          </div>
        )}

        {activePage === 'generator' && (
          <>
            <MetadataForm
              form={form}
              typeOptions={typeOptions}
              licenseOptions={licenseOptions}
              grantSuggestions={grantSuggestions}
              errors={validationErrors}
              touchedFields={touchedFields}
              importedMetadataAvailable={hasImportedMetadata}
              orcidSuggestions={orcidSuggestions}
              updateField={updateField}
              appendGrantSuggestion={appendGrantSuggestion}
              appendAllGrantSuggestions={appendAllGrantSuggestions}
              updateAuthorField={updateAuthorField}
              suggestOrcid={suggestOrcid}
              applySuggestedOrcid={applySuggestedOrcid}
              reorderAuthor={reorderAuthor}
              addAuthor={addAuthor}
              removeAuthor={removeAuthor}
            />

            <div className="actions">
              <button
                type="button"
                onClick={handleDownloadCitation}
                disabled={isDownloadingCitation}
                className={isDownloadingCitation ? 'loading-button' : ''}
              >
                {isDownloadingCitation && <span className="button-spinner" aria-hidden="true" />}
                {isDownloadingCitation ? 'Generating CITATION.cff…' : 'Generate CITATION.cff'}
              </button>
              <button
                type="button"
                className={`secondary ${isDownloadingZenodo ? 'loading-button' : ''}`}
                onClick={handleDownloadZenodo}
                disabled={isDownloadingZenodo}
              >
                {isDownloadingZenodo && <span className="button-spinner" aria-hidden="true" />}
                {isDownloadingZenodo ? 'Generating .zenodo.json…' : 'Generate .zenodo.json'}
              </button>
              <button
                type="button"
                className={`secondary ${isZipping ? 'loading-button' : ''}`}
                onClick={handleDownloadZip}
                disabled={isZipping}
              >
                {isZipping && <span className="button-spinner" aria-hidden="true" />}
                {isZipping ? 'Creating ZIP…' : 'Download ZIP (Both Files)'}
              </button>
            </div>
            <p className="filename-note">
              Keep the Zenodo filename as <strong>.zenodo.json</strong> for downstream tooling compatibility. The ZIP now includes <strong>METADATA_VALIDATION.txt</strong> with export checks.
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
          </>
        )}
      </section>
    </main>
  );
}
