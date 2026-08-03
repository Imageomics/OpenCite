import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { validateCitationCffText } from '../src/services/citationValidation.js';

const execAsync = promisify(exec);

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

async function runZenodraftValidation() {
  const command = 'npm exec -- zenodraft metadata validate .zenodo.json';

  console.log('\n.zenodo.json validation (zenodraft)');
  console.log('---------------------------------');

  try {
    const { stdout, stderr } = await execAsync(command, { cwd: process.cwd() });
    if (stdout) {
      process.stdout.write(stdout);
    }
    if (stderr) {
      process.stderr.write(stderr);
    }
    return true;
  } catch (error) {
    if (error && typeof error === 'object') {
      if ('stdout' in error && error.stdout) {
        process.stdout.write(String(error.stdout));
      }
      if ('stderr' in error && error.stderr) {
        process.stderr.write(String(error.stderr));
      }
    }
    return false;
  }
}

async function main() {
  const citationText = await readText('CITATION.cff');

  const citationResult = validateCitationCffText(citationText);

  printResult('CITATION.cff validation', citationResult);
  const zenodoIsValid = await runZenodraftValidation();

  const hasErrors = !citationResult.isValid || !zenodoIsValid;
  if (hasErrors) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Failed to validate metadata files:', error);
  process.exitCode = 1;
});
