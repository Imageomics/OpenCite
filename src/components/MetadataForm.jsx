export function MetadataForm({
  form,
  typeOptions,
  licenseOptions,
  grantSuggestions = [],
  errors = {},
  orcidSuggestions = {},
  updateField,
  appendGrantSuggestion,
  appendAllGrantSuggestions,
  updateAuthorField,
  suggestOrcid,
  applySuggestedOrcid,
  reorderAuthor,
  addAuthor,
  removeAuthor,
}) {
  return (
    <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
      <p className="full-width required-note">* required for valid metadata export</p>

      <section className="full-width form-section" aria-labelledby="section-basics-title">
        <header className="section-header">
          <p className="section-step">1. Basics</p>
          <h3 id="section-basics-title">Core project details</h3>
          <p className="section-lede">Start with what this work is and how people should reference it.</p>
        </header>
        <div className="section-grid">
          <label className={`full-width ${errors.title ? 'field-error' : ''}`}>
            <span>Title*</span>
            <input
              className={errors.title ? 'input-error' : ''}
              name="title"
              value={form.title}
              onChange={updateField}
              placeholder="Project title"
              aria-invalid={Boolean(errors.title)}
            />
            {errors.title ? <small className="error-text">{errors.title}</small> : null}
          </label>

          <label className="full-width">
            <span>Abstract</span>
            <textarea
              name="abstract"
              value={form.abstract}
              onChange={updateField}
              rows="6"
              placeholder="Short description of the work"
            />
          </label>
        </div>
      </section>

      <section className="full-width form-section" aria-labelledby="section-authors-title">
        <header className="section-header">
          <p className="section-step">2. Creators</p>
          <h3 id="section-authors-title">Author list and ORCID</h3>
          <p className="section-lede">Add authors in publication order, then enrich with ORCID and affiliation.</p>
        </header>
        <label className={`full-width ${errors.authors ? 'field-error' : ''}`}>
          <span>Authors*</span>
          <div className="authors-list">
            {form.authors.map((author, index) => (
              <div key={author.id ?? `author-${index}`} className="author-row">
                <input
                  value={author.givenNames}
                  onChange={(event) => updateAuthorField(index, 'givenNames', event.target.value)}
                  placeholder="Given names"
                />
                <input
                  value={author.familyNames}
                  onChange={(event) => updateAuthorField(index, 'familyNames', event.target.value)}
                  placeholder="Family names"
                />
                <input
                  value={author.orcid}
                  onChange={(event) => updateAuthorField(index, 'orcid', event.target.value)}
                  placeholder="ORCID (optional)"
                  className={errors.authorOrcid?.[index] ? 'input-error' : ''}
                  aria-invalid={Boolean(errors.authorOrcid?.[index])}
                />
                {errors.authorOrcid?.[index] ? <small className="error-text">{errors.authorOrcid[index]}</small> : null}
                <div className="orcid-tools">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => suggestOrcid(index)}
                    disabled={orcidSuggestions[index]?.loading}
                  >
                    {orcidSuggestions[index]?.loading ? 'Searching…' : 'Suggest ORCID'}
                  </button>
                  {orcidSuggestions[index]?.error ? <small className="error-text">{orcidSuggestions[index].error}</small> : null}
                  {orcidSuggestions[index]?.suggestions?.length > 0 ? (
                    <div className="orcid-suggestions">
                      {orcidSuggestions[index].suggestions.map((candidate) => (
                        <button
                          key={`${candidate.orcid}-${candidate.label}`}
                          type="button"
                          className="secondary orcid-suggestion"
                          onClick={() => applySuggestedOrcid(index, candidate)}
                        >
                          {candidate.label} - {candidate.orcid.replace('https://orcid.org/', '')}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <input
                  value={author.affiliation}
                  onChange={(event) => updateAuthorField(index, 'affiliation', event.target.value)}
                  placeholder="Affiliation (optional)"
                />
                <div className="author-actions">
                  <button
                    type="button"
                    className="secondary icon-button"
                    onClick={() => reorderAuthor(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move author ${index + 1} up`}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="secondary icon-button"
                    onClick={() => reorderAuthor(index, 1)}
                    disabled={index === form.authors.length - 1}
                    aria-label={`Move author ${index + 1} down`}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button type="button" className="secondary" onClick={() => removeAuthor(index)}>
                    Remove author
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="secondary" onClick={addAuthor}>
            Add author
          </button>
          {errors.authors ? <small className="error-text">{errors.authors}</small> : null}
        </label>
      </section>

      <section className="full-width form-section" aria-labelledby="section-publishing-title">
        <header className="section-header">
          <p className="section-step">3. Publishing metadata</p>
          <h3 id="section-publishing-title">Version, date, license, and identifiers</h3>
          <p className="section-lede">Use release-aligned values so your exports match what users see on GitHub and Zenodo.</p>
        </header>
        <div className="section-grid">
          <label className={errors.typeOfWork ? 'field-error' : ''}>
            <span>Type of work*</span>
            <select
              className={errors.typeOfWork ? 'input-error' : ''}
              name="typeOfWork"
              value={form.typeOfWork}
              onChange={updateField}
              aria-invalid={Boolean(errors.typeOfWork)}
            >
              {typeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.typeOfWork ? <small className="error-text">{errors.typeOfWork}</small> : null}
          </label>

          {form.typeOfWork === 'other' && (
            <label>
              <span>Specify type of work</span>
              <input
                name="customTypeOfWork"
                value={form.customTypeOfWork}
                onChange={updateField}
                placeholder="e.g., protocol, poster, thesis"
              />
            </label>
          )}

          <label className={errors.version ? 'field-error' : ''}>
            <span>Version*</span>
            <input
              className={errors.version ? 'input-error' : ''}
              name="version"
              value={form.version}
              onChange={updateField}
              placeholder="e.g. v1.2.3 or 1.2.3"
              aria-invalid={Boolean(errors.version)}
            />
            <small>Use Semantic Versioning (MAJOR.MINOR.PATCH), like <strong>1.2.3</strong> or <strong>v1.2.3</strong>. Use the exact value you plan to publish as your GitHub release tag.</small>
            <small>
              Need a refresher? See
              {' '}
              <a href="https://semver.org/" target="_blank" rel="noreferrer">semver.org</a>
              .
            </small>
            {errors.version ? <small className="error-text">{errors.version}</small> : null}
          </label>

          <label className={errors.publicationDate ? 'field-error' : ''}>
            <span>Publication date</span>
            <input
              className={errors.publicationDate ? 'input-error' : ''}
              name="publicationDate"
              value={form.publicationDate}
              onChange={updateField}
              placeholder="YYYY-MM-DD"
              aria-invalid={Boolean(errors.publicationDate)}
            />
            {errors.publicationDate ? <small className="error-text">{errors.publicationDate}</small> : null}
          </label>

          <label className={errors.license ? 'field-error' : ''}>
            <span>License*</span>
            <select
              className={errors.license ? 'input-error' : ''}
              name="license"
              value={form.license}
              onChange={updateField}
              aria-invalid={Boolean(errors.license)}
            >
              <option value="">Select license (SPDX code)</option>
              {licenseOptions.map((license) => (
                <option key={license} value={license}>
                  {license}
                </option>
              ))}
            </select>
            {errors.license ? <small className="error-text">{errors.license}</small> : null}
          </label>

          <label>
            <span>Repository URL</span>
            <input
              name="repositoryCode"
              value={form.repositoryCode}
              onChange={updateField}
              placeholder="https://github.com/user/repo"
            />
          </label>

          <label>
            <span>DOI (version-agnostic, from Zenodo)</span>
            <input name="doi" value={form.doi} onChange={updateField} placeholder="10.0000/zenodo.example.doi" />
          </label>

          <label>
            <span>Keywords</span>
            <input
              name="keywords"
              value={form.keywords}
              onChange={updateField}
              placeholder="open science, metadata, citation"
            />
          </label>
        </div>
      </section>

      <section className="full-width form-section" aria-labelledby="section-references-title">
        <header className="section-header">
          <p className="section-step">4. References</p>
          <h3 id="section-references-title">Related work and dependencies</h3>
        </header>
        <label className="full-width">
          <span>References</span>
          <textarea
            name="references"
            value={form.references}
            onChange={updateField}
            rows="8"
            placeholder={"One citation per line\n\nOr structured blocks separated by blank lines, for example:\n- type: software\ntitle: Example software title\nversion: 1.0.0\nauthors:\n  - family-names: Lastname\n    given-names: Firstname\nrepository-code: https://github.com/org/repo\ndate-released: 2025-01-01\ndoi: 10.0000/example\nlicense: MIT"}
          />
          <small>Use one plain-text citation per line, or use structured key:value blocks (separated by blank lines) for full Citation.cff references.</small>
        </label>
      </section>

      <section className="full-width form-section" aria-labelledby="section-funding-title">
        <header className="section-header">
          <p className="section-step">5. Funding</p>
          <h3 id="section-funding-title">Grant IDs and acknowledgements</h3>
        </header>
        <label className={`full-width ${errors.grants ? 'field-error' : ''}`}>
          <span>Grants</span>
          <textarea
            className={errors.grants ? 'input-error' : ''}
            name="grants"
            value={form.grants}
            onChange={updateField}
            rows="3"
            placeholder="One grant ID per line"
            aria-invalid={Boolean(errors.grants)}
          />
          <div className="grant-suggestions">
            {grantSuggestions.map((grant) => (
              <button
                key={grant.id}
                type="button"
                className="secondary"
                title={grant.note}
                onClick={() => appendGrantSuggestion(grant.id)}
              >
                Add {grant.label}
              </button>
            ))}
            <button type="button" className="secondary" onClick={appendAllGrantSuggestions}>
              Add all suggested grants
            </button>
          </div>
          <ul className="grant-reference-list">
            {grantSuggestions.map((grant) => (
              <li key={`reference-${grant.id}`}>
                <strong>{grant.id}</strong>
                {' '}
                -
                {' '}
                {grant.note}
              </li>
            ))}
          </ul>
          <small>Format: &lt;funder-code&gt;::&lt;grant-number&gt; (e.g., 021nxhr62::2118240)</small>
          {errors.grants ? <small className="error-text">{errors.grants}</small> : null}
        </label>
      </section>
    </form>
  );
}
