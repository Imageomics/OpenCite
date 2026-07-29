# AGENTS.md

Guidance for contributors and coding agents working in this repository.

## Quick Start

1. Confirm the request scope and avoid unrelated changes.
2. Read `README.md` and the relevant files in `src/` before editing.
3. Make the smallest viable change; do not restructure folders or rename files unless requested.
4. Run only the checks needed for the change (`npm run test` and/or `npm run build`).
5. Summarize what changed, why it changed, and any follow-up work.

> When in doubt: prefer existing project patterns over introducing new abstractions.

## Project Overview

OpenCite is a Vite + React single-page app that helps users generate two metadata files from one form:
- `CITATION.cff`
- `.zenodo.json`

OpenCite is browser-based and deployed through GitHub Pages
(`https://imageomics.github.io/OpenCite/`).

Primary goals:
- Keep metadata exports valid and stable.
- Keep the form workflow predictable and easy to edit.
- Preserve browser-first behavior (no Node-only runtime assumptions in app code).
- Maintain metadata quality through import, validation, comparison, and health
  feedback workflows.

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
npm run validate:metadata
npm run preview
```

## Imageomics Collaboration Expectations

Contributions should align with Imageomics principles of:

- Transparency
- Accountability
- Collaboration
- Safety

Expected behavior:

- Communicate clearly and respectfully.
- Keep changes focused and explain assumptions and tradeoffs.
- Provide enough context for others to reproduce and review results.

## Key File Map

- `README.md`
  - Contributor-facing run instructions plus release/citation metadata workflow guidance.
- `CONTRIBUTING.md`
  - Project contribution workflow, branch/PR conventions, and review expectations.
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
   - The exported filename should preserve the leading period once the active
     download bug is fixed.
3. For browser/Vite runtime configuration, prefer `import.meta.env` over `process.env`.
4. Preserve `CITATION.cff` export behavior, including identifiers for release URL and tag tree/commit URL when applicable.
5. Keep changes focused and minimal; avoid unrelated refactors.
6. Do not restructure folders, rename files, or alter public service APIs unless explicitly requested.

## Workflow Expectations

1. Read relevant files before editing.
2. Make the smallest viable change that satisfies the request.
3. If the request is documentation-only, update existing docs first (`README.md`, `CONTRIBUTING.md`, `AGENTS.md`) before creating new docs.
4. Run targeted checks:
   - `npm run test` for logic changes.
   - `npm run build` for UI/export pipeline changes.
5. If behavior changes user output, verify both generated files still render and download correctly.
6. Summarize exactly what changed and why.

## Scope Boundaries

- Do not perform broad formatting passes or cleanup-only changes outside the requested area.
- Do not replace existing workflows with new patterns when a localized fix is sufficient.
- Prefer updating existing documentation sections over creating new docs files.

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
