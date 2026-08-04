# OpenCite

OpenCite is a Vite + React single-page app that generates both `CITATION.cff` and `.zenodo.json` from a single metadata form.
It is browser-first (no Node-only runtime assumptions in app code) and part of
the Imageomics ecosystem.

Documentation and contributor workflows align with Imageomics principles of
transparency, accountability, collaboration, and safety.

## Overview

OpenCite helps maintain high-quality, release-ready citation metadata by letting
you:

- Generate `CITATION.cff` and `.zenodo.json` metadata from one form.
- Import metadata from GitHub repositories.
- Validate existing metadata files.
- Compare repository metadata against citation metadata.
- Review metadata health checks and recommendations.

Primary user entry point (deployed application):
https://imageomics.github.io/OpenCite/

The app is built to reduce release-time metadata drift by keeping citation fields consistent across:
- GitHub release tags and notes
- `CITATION.cff`
- `.zenodo.json`

## Supported Metadata Files

OpenCite focuses on:

- `CITATION.cff`
- `.zenodo.json`

These files should remain consistent with repository information, release
version, license, authors, grants, and DOI/references when available.

## Using OpenCite

1. Open the deployed application: https://imageomics.github.io/OpenCite/
2. Enter metadata directly, or import metadata from a GitHub repository.
3. Review generated `CITATION.cff` and `.zenodo.json` outputs.
4. Validate metadata before export.
5. Download generated metadata files (or ZIP export).

Most users should use the deployed application. Local setup is primarily for
contributors and development/testing workflows.

## Development Information

OpenCite is a React + Vite frontend. It is browser-first for runtime use, with
Node-based local tooling for development, tests, and metadata checks.

### Development Setup

```bash
npm install
npm run dev
```

Open the local URL shown by Vite and fill in the form. You can then:
- Generate `CITATION.cff`
- Generate `.zenodo.json`
- Download both together as a ZIP

### Running Tests and Build Commands

Run these commands from the repository root:

```bash
npm run dev      # Start local dev server
npm run build    # Production build
npm run test     # Node test runner
npm run validate:metadata # Validate root CITATION.cff and .zenodo.json
npm run preview  # Preview production build
```

`.zenodo.json` validation uses the official Zenodraft CLI via a pinned local
dependency. The direct equivalent command is:

```bash
npm exec -- zenodraft metadata validate .zenodo.json
```

During export, OpenCite validates generated `.zenodo.json` metadata. ZIP exports include `METADATA_VALIDATION.txt` for downstream provenance checks.

## GitHub Import Workflow

1. Paste a GitHub repository URL into the import field.
2. OpenCite automatically inspects known repository metadata files unless
   disabled by integration options.
  - Metadata file import reads from the repository's default branch (typically
    main).
  - OpenCite does not currently fetch CITATION.cff from a specific branch,
    tag, or commit referenced in the GitHub URL.
3. Supported import sources include:
   - `CITATION.cff`
   - `.zenodo.json`
   - package metadata (for example `package.json`, `pyproject.toml`, `setup.py`,
     `Cargo.toml`, `pom.xml`)
   - GitHub repository/release metadata and contributor data
4. Metadata is merged with precedence rules (release/repository provenance,
   citation/zenodo/package fields, and contributor enrichment) before loading
   the editable form.
5. Imported author lists include contributor-based context and are deduplicated.
6. Review, adjust, and regenerate metadata files before release.

## Validation Behavior

OpenCite validates metadata at multiple stages:

- Form-level validation before export.
- `CITATION.cff` and `.zenodo.json` content validation.
- Comparison checks between repository/GitHub metadata and citation metadata.
- Health checks that compare imported metadata with available repository/archive
  signals, including version, repository URL, license, authors, ORCID, DOI,
  and release information.
- Missing repository/archive information may produce warnings instead of
  failures.
- Author, grant, and reference metadata checks where applicable.
- Repository-level validation via `npm run validate:metadata` for root
  `CITATION.cff` and `.zenodo.json`.
  - `CITATION.cff` uses in-repo citation validation logic.
  - `.zenodo.json` uses the official Zenodraft validator.

## Metadata Rules

- Version values should match your planned GitHub release tag.
- Grant IDs must use `<funder-code>::<grant-number>`.
- Publication date should be a real `YYYY-MM-DD` date.
- ORCID values are validated when provided.
- References can be plain lines or structured key/value blocks.

## Semantic Versioning

OpenCite follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

- `MAJOR`: breaking or incompatible changes
- `MINOR`: backward-compatible features
- `PATCH`: backward-compatible bug fixes

Use the exact version/tag string you intend to publish for your GitHub release.

## Release Workflow

When preparing a release:

1. Create the GitHub release and include meaningful release notes.
2. Ensure the release tag matches the version used in OpenCite.
3. Update `CITATION.cff` fields as needed:
	- `version`
	- `date-released`
	- release identifiers/URLs
4. Update `.zenodo.json` metadata when applicable.
5. Verify release metadata is consistent across GitHub, `CITATION.cff`, and `.zenodo.json`.

OpenCite automatically includes GitHub release and source-tree identifiers in `CITATION.cff` when a version and repository URL are present.

## Grants Autofill

The Grants field includes one-click suggestions for:
- `021nxhr62::2118240` (Imageomics NSF grant)
- `021nxhr62::2330423` (ABC NSF grant; NSERC updates may be manual)

Suggestions can be added individually or all at once, and duplicate values are ignored.

## Project Structure

- `src/App.jsx`: main app orchestration and export flow
- `src/components/MetadataForm.jsx`: form UI and field interactions
- `src/validation/validation.js`: input validation and normalization
- `src/metadata/normalizeMetadata.js`: canonical metadata shaping
- `src/services/citation.js`: `CITATION.cff` serialization
- `src/services/zenodo.js`: `.zenodo.json` serialization
- `src/services/githubImporter.js`: GitHub import pipeline

## Repository Readiness Checklist

This checklist is based on the Imageomics Collaborative Distributed Science Guide repository recommendations.

- [x] `README.md` with project overview, usage, release workflow, and citation guidance.
- [x] `AGENTS.md` with code-agent project context and workflow constraints.
- [x] `.gitignore` present.
- [x] machine-readable dependency lockfile (`package-lock.json`) present.
- [x] `CONTRIBUTING.md` present and linked from README.
- [x] `LICENSE` file present in repository root.
- [x] root-level `CITATION.cff` committed for GitHub citation panel.
- [x] root-level `.zenodo.json` committed for release metadata tracking.
- [x] `CODE_OF_CONDUCT.md` present.
- [x] `SECURITY.md` present.
- [x] CI workflow present for pull requests (`.github/workflows/ci.yml`).

Before initial public release, make sure the unchecked items are completed.

## Contributing

Contributions are welcome for this repository.

See `CONTRIBUTING.md` for project-specific contribution workflow details.

1. Open an issue (or comment on an existing one) describing the change.
2. Create a branch for your work.
3. Keep changes focused on the requested feature or bug fix.
4. Run checks before opening a PR:
	- `npm run test`
	- `npm run build`
5. Open a pull request with:
	- a clear summary of what changed
	- why the change is needed
	- any screenshots or notes for UI changes

### Contribution Scope Guidelines

- Avoid unrelated refactors or broad formatting-only edits.
- Preserve export behavior for `CITATION.cff` and `.zenodo.json` unless the change explicitly targets that behavior.
- Keep public service APIs stable, especially under `src/services/`.
- Prefer updating existing documentation sections instead of creating duplicate docs.

## Learn More

- [Software citation practices (FORCE11 principles)](https://force11.org/info/software-citation-principles/)
- [GitHub release workflow](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [Zenodo GitHub integration guide](https://help.zenodo.org/docs/github/)
- [Citation File Format schema guide](https://github.com/citation-file-format/citation-file-format/blob/main/schema-guide.md)
- [Imageomics Repository Guide](https://imageomics.github.io/Collaborative-distributed-science-guide/wiki-guide/GitHub-Repo-Guide/)
- [Imageomics GitHub + PyPI + Zenodo Integration](https://imageomics.github.io/Collaborative-distributed-science-guide/wiki-guide/GitHub-PyPI-Zenodo-Integration/)
- [Downstream Verification Checklist](DOWNSTREAM_VERIFICATION_CHECKLIST.md)

## Known Issues

### .zenodo.json download filename issue

- The generated Zenodo metadata file should download with the exact filename:
  `.zenodo.json`.
- Some browser/file picker flows may remove the leading period during save.
- OpenCite uses a direct browser download path for `.zenodo.json` exports to
  preserve the canonical filename where supported.
- Verify saved filenames in your browser environment when preparing releases.

### Citation Health limitations

- Health checks were improved to reduce false positives, but some checks remain
  heuristic because repositories do not always include complete citation
  metadata.
- DOI checks depend on available Zenodo/archive signals.
- Author consistency checks may differ between citation authors and repository
  contributors because they represent different concepts.

### Metadata provenance limitations

- Health and comparison results are based on merged metadata.
- Field-level source tracking/provenance is not currently exposed in the UI.

### Citation format limitations

- `CITATION.cff` parsing supports common structures but does not fully model
  every advanced CFF feature.
- `preferred-citation` handling remains limited.

## Community and Security

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
