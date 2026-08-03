# Contributing to OpenCite

Thank you for contributing to OpenCite.

This document defines how to contribute safely and consistently to this repository.
It aligns OpenCite contribution practices with Imageomics Institute collaborative
development guidance.

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
npm run validate:metadata
```

`npm run validate:metadata` runs `CITATION.cff` checks and validates
`.zenodo.json` with the pinned Zenodraft CLI version used by CI.

3. Complete this checklist before submitting:

**Code changes:**

- [ ] Change is focused on one feature, fix, or documentation update.
- [ ] Tests were added or updated when applicable.
- [ ] Existing functionality was not unintentionally broken.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.

**Metadata and citation changes:**

- [ ] `CITATION.cff` remains valid.
- [ ] `.zenodo.json` remains valid.
- [ ] Citation metadata fields are consistent.
- [ ] Author and contributor information is reviewed.
- [ ] Version and release information are consistent.

**Documentation:**

- [ ] User-facing changes are documented.
- [ ] Repository guidance is updated if contributor workflows change.
- [ ] Links to related Imageomics or Collaborative Distributed Science resources are updated when relevant.

**Release readiness:**

- [ ] Version follows semantic versioning.
- [ ] Release notes or changelog information is prepared when applicable.
- [ ] GitHub release metadata, `CITATION.cff`, and Zenodo metadata remain consistent.

4. Verify metadata UX and outputs if you changed form/export behavior:
  - version guidance and validation still work
  - grant formatting remains valid (`<funder-code>::<grant-number>`)
  - `CITATION.cff` and `.zenodo.json` previews still generate

5. Include in your PR description:
  - what changed
  - why it changed
  - how it was tested
  - screenshots or preview snippets for UI/output changes

6. Confirm governance and policy docs remain consistent with your changes when applicable:
  - `README.md`
  - `CODE_OF_CONDUCT.md`
  - `SECURITY.md`

## Collaborative Distributed Science Practices

OpenCite follows Imageomics collaborative development practices. Contributors are
expected to:

- Support Imageomics community values of transparency, accountability,
  collaboration, and safety.
- Communicate clearly about scope, assumptions, and open questions.
- Communicate respectfully and align behavior with the Imageomics Code of
  Conduct.
- Prefer small, focused pull requests that are easier to review and validate.
- Give and receive review feedback respectfully and constructively.
- Give appropriate credit to contributors and prior work.
- Maintain reproducible and reusable scientific software practices in code,
  metadata, and documentation.

## Documentation Expectations

If behavior changes, update docs in the same pull request:

- `README.md` for getting started and project overview
- `CONTRIBUTING.md` for contributor workflow, branching, and pull request expectations
- `AGENTS.md` for agent workflow or repository guardrails

For detailed repository, GitHub, and GitHub + PyPI + Zenodo operational
workflows, reference the Imageomics Collaborative Distributed Science guides in
the References section instead of duplicating those instructions here.

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
- Downstream verification checklist:
  ./DOWNSTREAM_VERIFICATION_CHECKLIST.md

## CI Expectations

This repository runs a GitHub Actions CI workflow for pull requests and pushes to `main`:

- `.github/workflows/ci.yml`

Your pull request should pass:

- `npm run test`
- `npm run build`
