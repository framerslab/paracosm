/**
 * SSE envelope helper: validates stream events against the public
 * `StreamEventSchema` in development and emits raw in production (so
 * paying Zod parse cost per event doesn't land in hot paths).
 *
 * @module paracosm/runtime/io/sse-envelope
 */
import {
  StreamEventSchema,
  type StreamEvent,
} from '../../engine/schema/index.js';

/**
 * Emit a stream event through a validated envelope. In development
 * (`NODE_ENV !== 'production'`), every emission is parsed through the
 * Zod schema first — a malformed payload throws immediately at the call
 * site that produced it instead of surfacing downstream as a dashboard
 * reducer crash. In production the schema parse is skipped for perf.
 */
export function emitStreamEvent(
  emit: (event: unknown) => void,
  event: StreamEvent,
): void {
  if (process.env.NODE_ENV !== 'production') {
    const parsed = StreamEventSchema.parse(event);
    emit(parsed);
  } else {
    emit(event);
  }
}
