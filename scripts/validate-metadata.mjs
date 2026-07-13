import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { validateCitationCffText } from '../src/services/citationValidation.js';
import { validateZenodoJsonText } from '../src/services/zenodoValidation.js';

async function readText(relativePath) {
  const filePath = path.resolve(process.cwd(), relativePath);
  return readFile(filePath, 'utf8');
}

function printResult(title, result) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
  console.log(`Status: ${result.isValid ? 'PASS' : 'FAIL'}`);

  if (result.errors.length > 0) {
    console.log('Errors:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

async function main() {
  const [citationText, zenodoText] = await Promise.all([
    readText('CITATION.cff'),
    readText('.zenodo.json'),
  ]);

  const citationResult = validateCitationCffText(citationText);
  const zenodoResult = validateZenodoJsonText(zenodoText);

  printResult('CITATION.cff validation', citationResult);
  printResult('.zenodo.json validation', zenodoResult);

  const hasErrors = !citationResult.isValid || !zenodoResult.isValid;
  if (hasErrors) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Failed to validate metadata files:', error);
  process.exitCode = 1;
});
