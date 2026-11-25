import { z } from 'zod';

/** The leader fields a model can have written. */
export const AI_AUTHORED_LEADER_FIELDS = ['name', 'archetype', 'unit', 'hexaco', 'instructions'] as const;

/**
 * A model id as a generated leader's source records it: a letter or digit,
 * then up to 159 letters, digits, `_`, `.`, `:`, `/` or `-`. The run's
 * provenance names this id as the leader's writer, so free text is refused.
 */
export const AI_AUTHORSHIP_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/;

/** A leader's `aiAuthorship` as a request body carries it, each field named once. */
export const AiAuthorshipInputSchema = z.object({
  model: z.string().regex(AI_AUTHORSHIP_MODEL_PATTERN),
  fields: z.array(z.enum(AI_AUTHORED_LEADER_FIELDS)).max(AI_AUTHORED_LEADER_FIELDS.length)
    .transform(fields => [...new Set(fields)]),
});
