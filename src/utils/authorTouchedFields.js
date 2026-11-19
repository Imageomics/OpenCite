function remapAuthorTouchedFields(touchedFields, mapIndex) {
  const next = { ...touchedFields };

  for (const [key, value] of Object.entries(touchedFields)) {
    const match = key.match(/^authors\.(\d+)\.(.+)$/);
    if (!match) {
      continue;
    }

    delete next[key];
    const nextIndex = mapIndex(Number(match[1]));
    if (nextIndex !== null) {
      next[`authors.${nextIndex}.${match[2]}`] = value;
    }
  }

  return next;
}

export function removeAuthorTouchedFields(touchedFields, removedIndex) {
  return remapAuthorTouchedFields(touchedFields, (index) => {
    if (index === removedIndex) {
      return null;
    }
    return index > removedIndex ? index - 1 : index;
  });
}

export function swapAuthorTouchedFields(touchedFields, firstIndex, secondIndex) {
  return remapAuthorTouchedFields(touchedFields, (index) => {
    if (index === firstIndex) {
      return secondIndex;
    }
    if (index === secondIndex) {
      return firstIndex;
    }
    return index;
  });
}
