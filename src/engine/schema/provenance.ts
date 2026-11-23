import { RunProvenanceSchema } from './primitives.js';
import type { RunProvenance } from './types.js';

/** Mark model output with the public model identifiers assigned to its roles. */
export function makeRunProvenance(models: Readonly<Record<string, string>>): RunProvenance {
  return RunProvenanceSchema.parse({ aiGenerated: true, generator: 'paracosm', models });
}
