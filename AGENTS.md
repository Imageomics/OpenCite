# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

OpenCite is a Vite + React single-page app that helps users generate two metadata files from one form:
- `CITATION.cff`
- `.zenodo.json`

Primary goals:
- Keep metadata exports valid and stable.
- Keep the form workflow predictable and easy to edit.
- Preserve browser-first behavior (no Node-only runtime assumptions in app code).

## Tech Stack

- React 18
- Vite 5
- Plain JavaScript (ES modules)
- Node test runner (`node --test`) for utility-level tests

## Commands

Run from repo root:

```bash
npm install
npm run dev
npm run build
npm run test
npm run preview
```

## Key File Map

- `src/App.jsx`
  - Main app orchestration: form state, previews, export flow, import flow.
- `src/components/MetadataForm.jsx`
  - Form UI rendering and field-level interactions.
- `src/validation/validation.js`
  - Input normalization and validation checks.
- `src/metadata/normalizeMetadata.js`
  - Canonical metadata shaping before export.
- `src/services/citation.js`
  - `CITATION.cff` serialization.
- `src/services/zenodo.js`
  - `.zenodo.json` serialization.
- `src/services/githubImporter.js`
  - GitHub import pipeline; returns `{ metadata, warnings, errors }`.
- `src/services/github.js`
  - Legacy re-export surface for GitHub import API compatibility.
- `src/services/orcidSearch.js`
  - ORCID candidate lookup and scoring helpers.
- `src/utils/*.js`
  - Parsing/normalization helpers for authors, grants, keywords, references, ORCID.

## Repository Conventions

1. Use explicit `.js` and `.jsx` import specifiers in source files.
2. Canonical Zenodo export filename is `.zenodo.json` (with leading dot).
3. For browser/Vite runtime configuration, prefer `import.meta.env` over `process.env`.
4. Preserve `CITATION.cff` export behavior, including identifiers for release URL and tag tree/commit URL when applicable.
5. Keep changes focused and minimal; avoid unrelated refactors.

## Agent Workflow

1. Read relevant files before editing.
2. Make the smallest viable change that satisfies the request.
3. Run targeted checks:
   - `npm run test` for logic changes.
   - `npm run build` for UI/export pipeline changes.
4. If behavior changes user output, verify both generated files still render and download correctly.
5. Summarize exactly what changed and why.

## Validation and Data Rules

- Required metadata fields are validated before export.
- ORCID values must pass format/checksum validation when provided.
- Grant IDs use: `<funder-code>::<grant-number>`.
- Publication date should be a real `YYYY-MM-DD` date.
- References may be plain-text lines or structured blocks; do not silently drop entries.

## UI and Interaction Expectations

- Keep export notices actionable and specific.
- Do not remove confirmation safeguards that prevent accidental low-quality exports.
- Preserve author ordering tools and ORCID suggestion flow.

## Backward Compatibility

- Do not break public function names used across `src/services/*`.
- Keep `src/services/github.js` compatibility exports intact unless migration is requested.
- Avoid changing file names used in download/export without explicit request.

## Definition of Done for Agent Changes

- Code compiles (`npm run build`).
- Tests pass (`npm run test`) or test impact is clearly documented.
- No unintended changes to export filenames or core metadata shape.
- Any new assumptions are documented in README or inline code comments where needed.
