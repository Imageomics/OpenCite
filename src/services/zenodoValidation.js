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

function formatReport({ isValid, errors, warnings, payload }) {
  const lines = [
    'OpenCite Metadata Validation Report',
    '=================================',
    `Status: ${isValid ? 'PASS' : 'FAIL'}`,
    '',
    'File: .zenodo.json',
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
  lines.push(`- title: ${cleanString(payload.title) ? 'present' : 'missing'}`);
  lines.push(`- version: ${cleanString(payload.version) ? 'present' : 'missing'}`);
  lines.push(`- publication_date: ${cleanString(payload.publication_date) ? payload.publication_date : 'missing'}`);
  lines.push(`- creators: ${Array.isArray(payload.creators) ? payload.creators.length : 0}`);
  lines.push(`- grants: ${Array.isArray(payload.grants) ? payload.grants.length : 0}`);

  return lines.join('\n');
}

export function validateZenodoJsonText(text) {
  const errors = [];
  const warnings = [];
  const allowedUploadTypes = new Set([
    'publication',
    'poster',
    'presentation',
    'dataset',
    'image',
    'video',
    'software',
    'lesson',
    'physicalobject',
    'other',
  ]);
  const grantPattern = /^[A-Za-z0-9.-]+::[A-Za-z0-9.-]+$/;

  let payload;
  try {
    payload = JSON.parse(String(text ?? ''));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Invalid JSON: ${message}`);
    const report = formatReport({ isValid: false, errors, warnings, payload: {} });
    return { isValid: false, errors, warnings, payload: null, report };
  }

  const title = cleanString(payload.title);
  const version = cleanString(payload.version);
  const publicationDate = cleanString(payload.publication_date);
  const uploadType = cleanString(payload.upload_type);

  if (!title) {
    errors.push('title is required.');
  }

  if (!version) {
    errors.push('version is required.');
  }

  if (!publicationDate) {
    errors.push('publication_date is required.');
  } else if (!isValidIsoDate(publicationDate)) {
    errors.push('publication_date must be a real date in YYYY-MM-DD format.');
  }

  if (!uploadType) {
    warnings.push('upload_type is recommended for Zenodo deposits; OpenCite will infer software when generating an export.');
  } else if (!allowedUploadTypes.has(uploadType)) {
    warnings.push(`upload_type \"${uploadType}\" is not a common Zenodo upload_type value.`);
  }

  if (!Array.isArray(payload.creators) || payload.creators.length === 0) {
    errors.push('creators must include at least one creator entry.');
  } else {
    const missingCreatorNames = payload.creators.some((creator) => !cleanString(creator?.name));
    if (missingCreatorNames) {
      errors.push('each creator entry must include a non-empty name.');
    }
  }

  if (!Array.isArray(payload.grants)) {
    warnings.push('grants should be an array of objects containing an id field.');
  } else {
    for (let index = 0; index < payload.grants.length; index += 1) {
      const grant = payload.grants[index];
      const grantId = cleanString(grant?.id);
      if (!grantId) {
        warnings.push(`grants[${index}] is missing id.`);
        continue;
      }

      if (!grantPattern.test(grantId)) {
        errors.push(`grants[${index}].id must match <funder-code>::<grant-number>.`);
      }
    }
  }

  const isValid = errors.length === 0;
  const report = formatReport({ isValid, errors, warnings, payload });

  return {
    isValid,
    errors,
    warnings,
    payload,
    report,
  };
}
