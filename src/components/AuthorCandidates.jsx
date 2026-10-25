import { findMatchingAuthorIndex, formatWindow } from '../services/githubImporterAuthorCandidates.js';

const SOURCE_LABELS = {
  'github-contributor': 'GitHub contributor',
  'commit-history': 'Commit history',
  'co-author': 'Co-author trailer',
};

export function ContributorImportOptions({ limit, since, until, onLimitChange, onSinceChange, onUntilChange }) {
  return (
    <fieldset className="contributor-options">
      <legend>GitHub contributor options</legend>
      <label>
        <span>Authors to credit automatically</span>
        <input
          type="number"
          min="0"
          max="50"
          value={limit}
          onChange={(event) => onLimitChange(event.target.value)}
          placeholder="5"
        />
      </label>
      <label>
        <span>Ignore contributions before (optional)</span>
        <input type="date" value={since} max={until || undefined} onChange={(event) => onSinceChange(event.target.value)} />
      </label>
      <label>
        <span>Ignore contributions after (optional)</span>
        <input type="date" value={until} min={since || undefined} onChange={(event) => onUntilChange(event.target.value)} />
      </label>
      <p className="import-note">
        Everyone found is listed as a candidate you can add or remove. Set a date when a repository inherited
        history from another project, or to stop at a release date; contributors with no commits in that range are not credited automatically.
      </p>
    </fieldset>
  );
}

export function AuthorCandidates({ candidates, authors, since, until, onToggle }) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const isSelected = (candidate) => findMatchingAuthorIndex(authors, candidate) !== -1;
  const selectedCount = candidates.filter(isSelected).length;

  return (
    <section className="full-width form-section author-candidates" aria-labelledby="author-candidates-title">
      <header className="section-header">
        <h3 id="author-candidates-title">GitHub author candidates</h3>
        <p className="section-lede">
          {selectedCount} of {candidates.length} selected. Commit counts show activity, not authorship; check
          only the people who should be credited.
          {since || until ? ` Contributors with no commits ${formatWindow(since, until)} are flagged.` : ''}
        </p>
      </header>
      <ul className="candidate-list">
        {candidates.map((candidate) => {
          const checked = isSelected(candidate);
          const name = [candidate.givenNames, candidate.familyNames].filter(Boolean).join(' ');
          return (
            <li key={candidate.id}>
              <label className="candidate-row">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggle(candidate, event.target.checked)}
                />
                <span>
                  <strong>{name}</strong>
                  <small>{candidate.sources.map((source) => SOURCE_LABELS[source] ?? source).join(' + ')}</small>
                  <small>{candidate.reason}</small>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
