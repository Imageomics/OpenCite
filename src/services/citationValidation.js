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

function extractSingleScalar(text, key) {
  const regex = new RegExp(`^${key}:\\s*(.+)\\s*$`, 'm');
  const value = cleanString((String(text).match(regex) || [])[1]);

  if (!value) {
    return '';
  }

  const quotedMatch = value.match(/^"(.*)"$/) || value.match(/^'(.*)'$/);
  return cleanString(quotedMatch ? quotedMatch[1] : value);
}

function hasAuthorsArrayWithEntry(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const authorsIndex = lines.findIndex((line) => /^authors:\s*(.*)$/.test(line));

  if (authorsIndex < 0) {
    return false;
  }

  const authorsLineMatch = lines[authorsIndex].match(/^authors:\s*(.*)$/);
  const trailing = cleanString(authorsLineMatch ? authorsLineMatch[1] : '');

  if (trailing) {
    if (/^\[\s*\]$/.test(trailing)) {
      return false;
    }

    if (/^\[.*\]$/.test(trailing)) {
      return cleanString(trailing.slice(1, -1)).length > 0;
    }

    return false;
  }

  const authorsIndent = (lines[authorsIndex].match(/^\s*/) || [''])[0].length;

  for (let index = authorsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim() && (line.match(/^\s*/) || [''])[0].length <= authorsIndent && !/^\s*-\s+/.test(line)) {
      break;
    }

    if (/^\s*-\s+/.test(line)) {
      return true;
    }
  }

  return false;
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

  return lines.join('\n');
}

export function validateCitationCffText(text) {
  const errors = [];
  const warnings = [];
  const content = String(text ?? '');

  const cffVersion = extractSingleScalar(content, 'cff-version');
  const title = extractSingleScalar(content, 'title');
  const version = extractSingleScalar(content, 'version');
  const dateReleased = extractSingleScalar(content, 'date-released');
  const repositoryCode = extractSingleScalar(content, 'repository-code');

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

  if (!hasAuthorsArrayWithEntry(content)) {
    errors.push('authors must include at least one author entry.');
  }

  if (!repositoryCode) {
    warnings.push('repository-code is recommended for provenance and release linking.');
  }

  if (!/^https?:\/\//i.test(repositoryCode || '')) {
    warnings.push('repository-code should be an absolute URL.');
  }

  const isValid = errors.length === 0;
  const fields = {
    title,
    version,
    dateReleased,
    repositoryCode,
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
