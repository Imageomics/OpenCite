export function updateMetadataField(form, name, value) {
  if (form[name] === value) {
    return form;
  }

  if (name === 'version' || name === 'repositoryCode') {
    return { ...form, [name]: value, releaseTag: '', releaseCommit: '' };
  }
  if (name === 'releaseTag') {
    return { ...form, releaseTag: value, releaseCommit: '' };
  }
  return { ...form, [name]: value };
}
