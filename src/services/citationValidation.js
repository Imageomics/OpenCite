function cleanString(value) {
  return String(value ?? '').trim();
}

function isValidIsoDate(value) {
  const text = cleanString(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }

  const [yearText, monthText, dayText] = text.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function extractSingleQuotedScalar(text, key) {
  const regex = new RegExp(`^${key}:\\s*\"([^\"]+)\"\\s*$`, 'm');
  return cleanString((String(text).match(regex) || [])[1]);
}

function extractSingleScalar(text, key) {
  const regex = new RegExp(`^${key}:\\s*(.+)\\s*$`, 'm');
  return cleanString((String(text).match(regex) || [])[1]);
}

function extractGrantIds(text) {
  return [...String(text).matchAll(/^\s*-\s+id:\s*"([^"]+)"\s*$/gm)]
    .map((match) => cleanString(match[1]))
    .filter(Boolean);
}

function formatReport({ isValid, errors, warnings, fields }) {
  const lines = [
    'OpenCite Metadata Validation Report',
    '=================================',
    `Status: ${isValid ? 'PASS' : 'FAIL'}`,
    '',
    'File: CITATION.cff',
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  if (errors.length > 0) {
    lines.push('Errors:');
    for (const error of errors) {
      lines.push(`- ${error}`);
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  lines.push('Summary:');
  lines.push(`- title: ${fields.title ? 'present' : 'missing'}`);
  lines.push(`- version: ${fields.version ? fields.version : 'missing'}`);
  lines.push(`- date-released: ${fields.dateReleased ? fields.dateReleased : 'missing'}`);
  lines.push(`- repository-code: ${fields.repositoryCode ? 'present' : 'missing'}`);
  lines.push(`- grants: ${fields.grantsCount}`);

  return lines.join('\n');
}

export function validateCitationCffText(text) {
  const errors = [];
  const warnings = [];
  const content = String(text ?? '');

  const cffVersion = extractSingleScalar(content, 'cff-version').replace(/"/g, '');
  const title = extractSingleQuotedScalar(content, 'title');
  const version = extractSingleQuotedScalar(content, 'version');
  const dateReleased = extractSingleQuotedScalar(content, 'date-released');
  const repositoryCode = extractSingleQuotedScalar(content, 'repository-code');
  const grantIds = extractGrantIds(content);
  const grantPattern = /^[A-Za-z0-9.-]+::[A-Za-z0-9.-]+$/;

  if (!cffVersion) {
    errors.push('cff-version is required.');
  }

  if (!title) {
    errors.push('title is required.');
  }

  if (!version) {
    errors.push('version is required.');
  }

  if (!dateReleased) {
    errors.push('date-released is required.');
  } else if (!isValidIsoDate(dateReleased)) {
    errors.push('date-released must be a real date in YYYY-MM-DD format.');
  }

  if (!repositoryCode) {
    warnings.push('repository-code is recommended for provenance and release linking.');
  }

  if (!/^https?:\/\//i.test(repositoryCode || '')) {
    warnings.push('repository-code should be an absolute URL.');
  }

  for (let index = 0; index < grantIds.length; index += 1) {
    if (!grantPattern.test(grantIds[index])) {
      errors.push(`grants[${index}] id must match <funder-code>::<grant-number>.`);
    }
  }

  const isValid = errors.length === 0;
  const fields = {
    title,
    version,
    dateReleased,
    repositoryCode,
    grantsCount: grantIds.length,
  };
  const report = formatReport({ isValid, errors, warnings, fields });

  return {
    isValid,
    errors,
    warnings,
    fields,
    report,
  };
}
