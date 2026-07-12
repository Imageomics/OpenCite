# Contributing to OpenCite

Thank you for contributing to OpenCite.

This document defines how to contribute safely and consistently to this repository.

## Scope

- Keep pull requests focused on one feature or bug fix.
- Avoid unrelated refactors and formatting-only changes.
- Preserve existing export behavior for `CITATION.cff` and `.zenodo.json` unless your change is explicitly about metadata output.

## Development Setup

1. Fork the repository and create a branch from `main`.
2. Install dependencies:

```bash
npm install
```

3. Run the app locally:

```bash
npm run dev
```

## Branching and Commits

- Do not work directly on `main`.
- Use descriptive branch names, for example:
  - `feature/issue-123/grant-autofill`
  - `bugfix/issue-88/semver-validation`
  - `docs/issue-40/readme-contributing`
- Use clear commit messages that explain the change and intent.

## Pull Request Checklist

Before opening a pull request:

1. Confirm the change matches the issue/task scope.
2. Run checks:

```bash
npm run test
npm run build
```

3. Verify metadata UX and outputs if you changed form/export behavior:
   - version guidance and validation still work
   - grant formatting remains valid (`<funder-code>::<grant-number>`)
   - `CITATION.cff` and `.zenodo.json` previews still generate

4. Include in your PR description:
   - what changed
   - why it changed
   - screenshots or preview snippets for UI/output changes

5. Confirm governance and policy docs remain consistent with your changes when applicable:
  - `README.md`
  - `CODE_OF_CONDUCT.md`
  - `SECURITY.md`

## Documentation Expectations

If behavior changes, update docs in the same pull request:

- `README.md` for user-facing behavior and release/citation workflow
- `AGENTS.md` for agent workflow or repository guardrails
- `CONTRIBUTING.md` for contributor process updates

## Release and Metadata Notes

For release-related work, keep release metadata aligned across:

- GitHub release tag and description
- generated `CITATION.cff`
- generated `.zenodo.json`

Use semantic versioning and ensure version/date values are consistent.

## References

- Imageomics Repository Guide:
  https://imageomics.github.io/Collaborative-distributed-science-guide/wiki-guide/GitHub-Repo-Guide/
- Imageomics GitHub + PyPI + Zenodo Integration:
  https://imageomics.github.io/Collaborative-distributed-science-guide/wiki-guide/GitHub-PyPI-Zenodo-Integration/
- Semantic Versioning:
  https://semver.org/

## CI Expectations

This repository runs a GitHub Actions CI workflow for pull requests and pushes to `main`:

- `.github/workflows/ci.yml`

Your pull request should pass:

- `npm run test`
- `npm run build`
