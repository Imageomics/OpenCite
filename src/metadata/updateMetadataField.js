import { getDefaultReleaseTag, releaseTagMatchesVersion } from './releaseTag.js';

export function updateMetadataField(form, name, value) {
  if (form[name] === value) {
    return form;
  }

  if (name === 'version') {
    const releaseTag = !form.releaseTag || releaseTagMatchesVersion(form.version, form.releaseTag)
      ? getDefaultReleaseTag(value)
      : form.releaseTag;
    return { ...form, version: value, releaseTag, releaseCommit: '' };
  }
  if (name === 'repositoryCode') {
    return { ...form, repositoryCode: value, releaseTag: getDefaultReleaseTag(form.version), releaseCommit: '' };
  }
  if (name === 'releaseTag') {
    return { ...form, releaseTag: value, releaseCommit: '' };
  }
  return { ...form, [name]: value };
}
