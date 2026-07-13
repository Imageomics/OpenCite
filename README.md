# OpenCite

OpenCite is a Vite + React single-page app that generates both `CITATION.cff` and `.zenodo.json` from a single metadata form.

The app is built to reduce release-time metadata drift by keeping citation fields consistent across:
- GitHub release tags and notes
- `CITATION.cff`
- `.zenodo.json`

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL shown by Vite and fill in the form. You can then:
- Generate `CITATION.cff`
- Generate `.zenodo.json`
- Download both together as a ZIP

## Scripts

```bash
npm run dev      # Start local dev server
npm run build    # Production build
npm run test     # Node test runner
npm run validate:metadata # Validate root CITATION.cff and .zenodo.json
npm run preview  # Preview production build
```

## Core Workflow

1. Enter project metadata once in the form.
2. Optionally import metadata from a GitHub repository URL.
3. Review generated previews for `CITATION.cff` and `.zenodo.json`.
4. Download each file or export both as a ZIP.

During export, OpenCite validates generated `.zenodo.json` metadata. ZIP exports include `METADATA_VALIDATION.txt` for downstream provenance checks.

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

## Community and Security

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
