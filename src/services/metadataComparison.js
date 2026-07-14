import { runMetadataValidators } from './metadataValidators.js';

export function compareExistingMetadataFiles(context) {
  const comparisons = [];

  if (context.fileValidationSummary?.citation?.present && context.citationForComparison) {
    comparisons.push(
      ...runMetadataValidators({
        file: 'CITATION.cff',
        metadata: context.citationForComparison,
        context,
      }),
    );
  }

  if (context.fileValidationSummary?.zenodo?.present && context.zenodoForComparison) {
    comparisons.push(
      ...runMetadataValidators({
        file: '.zenodo.json',
        metadata: context.zenodoForComparison,
        context,
      }),
    );
  }

  return comparisons;
}
