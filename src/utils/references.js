function cleanQuoted(value) {
  const text = String(value ?? '').trim();
  return text.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
}

function parseAuthorLine(line) {
  const inlineMatch = line.trim().match(/^-\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
  if (!inlineMatch) {
    return null;
  }

  const [, key, value] = inlineMatch;
  return { [key]: cleanQuoted(value) };
}

function parseStructuredReferenceBlock(block) {
  const lines = block
    .split('\n')
    .map((line) => line.replace(/\r/g, ''))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return null;
  }

  const reference = {};
  let currentAuthor = null;
  let inAuthors = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (/^authors\s*:\s*$/i.test(trimmed)) {
      reference.authors = reference.authors || [];
      inAuthors = true;
      currentAuthor = null;
      continue;
    }

    if (inAuthors) {
      if (/^\s*-\s+[A-Za-z0-9_-]+\s*:/.test(rawLine)) {
        const parsedAuthor = parseAuthorLine(trimmed);
        if (parsedAuthor) {
          currentAuthor = parsedAuthor;
          reference.authors.push(currentAuthor);
        }
        continue;
      }

      if (currentAuthor && /^\s{2,}[A-Za-z0-9_-]+\s*:\s*(.*)$/.test(rawLine)) {
        const [, key, value] = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/) || [];
        if (key) {
          currentAuthor[key] = cleanQuoted(value);
          continue;
        }
      }

      // Exit authors mode when we hit a non-author top-level field.
      if (/^[A-Za-z0-9_-]+\s*:\s*(.*)$/.test(trimmed)) {
        inAuthors = false;
        currentAuthor = null;
      } else {
        continue;
      }
    }

    const fieldMatch = trimmed.match(/^-?\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!fieldMatch) {
      continue;
    }

    const [, key, value] = fieldMatch;
    reference[key] = cleanQuoted(value);
  }

  return Object.keys(reference).length > 0 ? reference : null;
}

export function normalizeReferences(referencesText) {
  const text = String(referencesText ?? '').trim();
  if (!text) {
    return [];
  }

  const blocks = text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const references = [];

  for (const block of blocks) {
    const looksStructured = /(^|\n)\s*-?\s*[A-Za-z0-9_-]+\s*:/.test(block);

    if (looksStructured) {
      const structured = parseStructuredReferenceBlock(block);
      if (structured) {
        references.push(structured);
        continue;
      }
    }

    references.push(...block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean));
  }

  return references;
}
