function createFinding({
  id,
  status,
  severity,
  category,
  file,
  field,
  message,
  recommendation,
  action,
}) {
  return {
    id,
    status,
    severity,
    category,
    file,
    field,
    message,
    recommendation,
    action,
  };
}

function fileLabelFromSource(source) {
  if (source === 'citation') {
    return 'CITATION.cff';
  }

  if (source === 'zenodo') {
    return '.zenodo.json';
  }

  return '';
}

function summarizeFindings(findings) {
  const counts = {
    correct: 0,
    missing: 0,
    outdated: 0,
    invalid: 0,
  };

  for (const finding of findings) {
    if (Object.prototype.hasOwnProperty.call(counts, finding.status)) {
      counts[finding.status] += 1;
    }
  }

  return {
    total: findings.length,
    byStatus: counts,
  };
}

function buildRecommendations(findings, fileValidationSummary) {
  const hasInvalid = findings.some((finding) => finding.status === 'invalid');
  const hasOutdated = findings.some((finding) => finding.status === 'outdated');
  const hasMissing = findings.some((finding) => finding.status === 'missing');

  const citationNeedsRegenerate = findings.some(
    (finding) => finding.file === 'CITATION.cff' && finding.action === 'regenerate-file',
  );
  const zenodoNeedsRegenerate = findings.some(
    (finding) => finding.file === '.zenodo.json' && finding.action === 'regenerate-file',
  );

  const canKeepCurrentFiles = !hasInvalid && !hasOutdated && !hasMissing;
  const canUpdateSpecificFields = !hasInvalid && (hasOutdated || hasMissing);
  const shouldGenerateNewFiles = hasInvalid
    || !fileValidationSummary?.citation?.present
    || !fileValidationSummary?.zenodo?.present;

  const actions = [];

  if (canKeepCurrentFiles) {
    actions.push('Keep current files as-is. Metadata is already consistent with repository state.');
  }

  if (canUpdateSpecificFields) {
    actions.push('Update specific outdated or missing fields without replacing the whole files.');
  }

  if (shouldGenerateNewFiles) {
    actions.push('Generate fresh metadata files for invalid or missing files.');
  }

  actions.push('Import review never overwrites repository files automatically; you choose what to update.');

  return {
    canKeepCurrentFiles,
    canUpdateSpecificFields,
    shouldGenerateNewFiles,
    citationNeedsRegenerate,
    zenodoNeedsRegenerate,
    actions,
  };
}

function ruleCitationFileState(context) {
  const citation = context.fileValidationSummary?.citation;
  if (!citation?.present) {
    return createFinding({
      id: 'citation-missing',
      status: 'missing',
      severity: 'medium',
      category: 'file-state',
      file: 'CITATION.cff',
      field: '',
      message: 'CITATION.cff was not found in the repository.',
      recommendation: 'Generate CITATION.cff or add the required fields manually.',
      action: 'generate-file',
    });
  }

  if (!citation.valid) {
    return createFinding({
      id: 'citation-invalid',
      status: 'invalid',
      severity: 'high',
      category: 'schema',
      file: 'CITATION.cff',
      field: '',
      message: `CITATION.cff is invalid: ${(citation.errors || []).join(' | ')}`,
      recommendation: 'Fix validation errors first; regenerate file if many fields are broken.',
      action: 'regenerate-file',
    });
  }

  return createFinding({
    id: 'citation-valid',
    status: 'correct',
    severity: 'low',
    category: 'file-state',
    file: 'CITATION.cff',
    field: '',
    message: 'CITATION.cff exists and passes schema validation.',
    recommendation: 'Keep file and only update changed fields when needed.',
    action: 'keep-file',
  });
}

function ruleZenodoFileState(context) {
  const zenodo = context.fileValidationSummary?.zenodo;
  if (!zenodo?.present) {
    return createFinding({
      id: 'zenodo-missing',
      status: 'missing',
      severity: 'medium',
      category: 'file-state',
      file: '.zenodo.json',
      field: '',
      message: '.zenodo.json was not found in the repository.',
      recommendation: 'Generate .zenodo.json or add required fields manually.',
      action: 'generate-file',
    });
  }

  if (!zenodo.valid) {
    return createFinding({
      id: 'zenodo-invalid',
      status: 'invalid',
      severity: 'high',
      category: 'schema',
      file: '.zenodo.json',
      field: '',
      message: `.zenodo.json is invalid: ${(zenodo.errors || []).join(' | ')}`,
      recommendation: 'Fix validation errors first; regenerate file if many fields are broken.',
      action: 'regenerate-file',
    });
  }

  return createFinding({
    id: 'zenodo-valid',
    status: 'correct',
    severity: 'low',
    category: 'file-state',
    file: '.zenodo.json',
    field: '',
    message: '.zenodo.json exists and passes schema validation.',
    recommendation: 'Keep file and only update changed fields when needed.',
    action: 'keep-file',
  });
}

function warningToField(code) {
  if (code === 'version-mismatch' || code === 'cross-file-version-mismatch') return 'version';
  if (code === 'date-mismatch') return 'publicationDate';
  if (code === 'repository-url-mismatch') return 'repositoryCode';
  if (code === 'license-mismatch') return 'license';
  if (code === 'missing-version') return 'version';
  return '';
}

function warningToStatus(code) {
  if (code === 'missing-version') {
    return 'missing';
  }

  return 'outdated';
}

function warningToAction(code) {
  if (code === 'missing-version') {
    return 'update-field';
  }

  return 'update-field';
}

function warningToRecommendation(code) {
  if (code === 'missing-version') {
    return 'Set version from latest release tag or add it manually if release data is unavailable.';
  }

  return 'Update the field to match current repository metadata.';
}

function ruleRepositoryConsistencyWarnings(context) {
  const trackedCodes = new Set([
    'version-mismatch',
    'cross-file-version-mismatch',
    'date-mismatch',
    'repository-url-mismatch',
    'license-mismatch',
    'missing-version',
  ]);

  const findings = [];
  const seen = new Set();

  for (const warning of context.warnings || []) {
    const code = String(warning?.code ?? '');
    if (!trackedCodes.has(code)) {
      continue;
    }

    const source = String(warning?.source ?? '');
    const key = `${code}|${source}|${warning?.message ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    findings.push(createFinding({
      id: `consistency-${seen.size}`,
      status: warningToStatus(code),
      severity: code === 'missing-version' ? 'high' : 'medium',
      category: 'consistency',
      file: fileLabelFromSource(source),
      field: warningToField(code),
      message: String(warning?.message ?? 'Metadata consistency issue detected.'),
      recommendation: warningToRecommendation(code),
      action: warningToAction(code),
    }));
  }

  return findings;
}

export const defaultMetadataReviewRules = [
  ruleCitationFileState,
  ruleZenodoFileState,
  ruleRepositoryConsistencyWarnings,
];

export function runMetadataReviewPipeline(context, rules = defaultMetadataReviewRules) {
  const findings = [];

  for (const rule of rules) {
    const result = rule(context);
    if (Array.isArray(result)) {
      findings.push(...result.filter(Boolean));
    } else if (result) {
      findings.push(result);
    }
  }

  const summary = summarizeFindings(findings);
  const recommendations = buildRecommendations(findings, context.fileValidationSummary);

  return {
    findings,
    summary,
    recommendations,
  };
}
