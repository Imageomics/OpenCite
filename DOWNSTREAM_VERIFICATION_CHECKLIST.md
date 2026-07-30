# Downstream Verification Checklist

Use this checklist to verify generated metadata works in downstream release and citation workflows.

## Prerequisites

- Root metadata files are up to date:
  - `CITATION.cff`
  - `.zenodo.json`
- Local checks pass:

```bash
npm run test
npm run build
npm run validate:metadata
```

## In-App Export Verification

1. Open the deployed application (recommended for user-facing verification):

  https://imageomics.github.io/OpenCite/

2. If you need local verification during development, start app:

```bash
npm run dev
```

3. Fill required fields and generate:
- `CITATION.cff`
- `.zenodo.json`
- ZIP export

4. Confirm ZIP contains:
- `CITATION.cff`
- `.zenodo.json`
- `METADATA_VALIDATION.txt`

5. Confirm `.zenodo.json` filename is preserved exactly (with leading dot).

## GitHub Citation Verification

1. Commit and push `CITATION.cff` to a branch.
2. Open repository page for that branch.
3. Verify the "Cite this repository" panel renders expected metadata.

## Zenodo Metadata Verification

1. Open generated `.zenodo.json`.
2. Confirm key fields:
- `title`
- `version`
- `publication_date`
- `creators`
- `grants`

3. If using GitHub-Zenodo integration, perform a test release/deposition flow and verify no ingestion errors.

## Provenance Consistency Check

Confirm release metadata stays consistent across:

- GitHub release tag and notes
- Generated `CITATION.cff`
- Generated `.zenodo.json`

## Optional Issue Tracking Prompts

If failures are found, open issues with:

- exact reproduction steps
- sample generated files (or sanitized excerpts)
- expected vs observed behavior
- whether failure occurred in app validation, GitHub rendering, or downstream ingestion
