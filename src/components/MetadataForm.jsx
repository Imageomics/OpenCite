export function MetadataForm({
  form,
  typeOptions,
  licenseOptions,
  updateField,
  updateAuthorField,
  addAuthor,
  removeAuthor,
}) {
  return (
    <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
      <label className="full-width">
        <span>Title</span>
        <input name="title" value={form.title} onChange={updateField} placeholder="Project title" />
      </label>

      <label className="full-width">
        <span>Authors</span>
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
              />
              <input
                value={author.affiliation}
                onChange={(event) => updateAuthorField(index, 'affiliation', event.target.value)}
                placeholder="Affiliation (optional)"
              />
              <button type="button" className="secondary" onClick={() => removeAuthor(index)}>
                Remove author
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="secondary" onClick={addAuthor}>
          Add author
        </button>
      </label>

      <label>
        <span>License</span>
        <select name="license" value={form.license} onChange={updateField}>
          <option value="">Select license (SPDX code)</option>
          {licenseOptions.map((license) => (
            <option key={license} value={license}>
              {license}
            </option>
          ))}
        </select>
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

      <label>
        <span>Type of work</span>
        <select name="typeOfWork" value={form.typeOfWork} onChange={updateField}>
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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

      <label>
        <span>Version</span>
        <input name="version" value={form.version} onChange={updateField} placeholder="1.0.0" />
      </label>

      <label>
        <span>Publication date</span>
        <input
          name="publicationDate"
          value={form.publicationDate}
          onChange={updateField}
          placeholder="YYYY-MM-DD"
        />
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

      <label className="full-width">
        <span>References</span>
        <textarea
          name="references"
          value={form.references}
          onChange={updateField}
          rows="4"
          placeholder="One citation per line"
        />
        <small>One reference per line. Plain text citation format.</small>
      </label>

      <label className="full-width">
        <span>Grants</span>
        <textarea
          name="grants"
          value={form.grants}
          onChange={updateField}
          rows="3"
          placeholder="One grant ID per line"
        />
        <small>Format: &lt;funder-code&gt;::&lt;grant-number&gt; (e.g., 021nxhr62::2118240)</small>
      </label>
    </form>
  );
}
