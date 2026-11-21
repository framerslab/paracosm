import { useEffect, useId, useState, type CSSProperties, type MouseEvent } from 'react';
import type { ForgeAttemptRecord, ToolEntry } from '../../../hooks/useToolRegistry';
import { REQUEST_WORDS, actorLine, goToEvent } from '../forgeWords';
import styles from './stations.module.scss';

/** The actor a tool was forged under, as its tile names it. */
export interface RequestActor {
  label: string;
  name: string;
  archetype: string;
  /** The actor's run colour, for the rule beside its line. */
  colour: string;
}

export interface RequestStationProps {
  entry: ToolEntry;
  /** The attempt shown; null for a tool known from its report alone. */
  attempt: ForgeAttemptRecord | null;
  actor: RequestActor;
  /** Closes the trace and moves focus to the event the tool was made for. */
  onGoToEvent: (target: HTMLElement) => void;
}

/** One declared field. `type` is null when the record names the field and holds no schema; `required` then too. */
interface FieldRow {
  name: string;
  type: string | null;
  required: boolean | null;
  description: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function typeOf(property: unknown): string {
  if (!isObject(property)) return '';
  const { type } = property;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string').join(' | ');
  return '';
}

/**
 * A tool's fields of one side: from its schema where the record holds one;
 * otherwise the field names the record holds, with nothing said of their
 * type; none when it declares no field.
 */
function fieldRows(schema: unknown, names: string[]): FieldRow[] {
  if (isObject(schema) && isObject(schema.properties)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    return Object.entries(schema.properties).map(([name, property]) => ({
      name,
      type: typeOf(property),
      required: required.includes(name),
      description: isObject(property) && typeof property.description === 'string' ? property.description : '',
    }));
  }
  return names.map((name) => ({ name, type: null, required: null, description: '' }));
}

/**
 * A schema for the attempt on show: the tool's schema where the attempt names
 * no fields of its own or the schema declares exactly those fields, else none.
 */
function schemaFor(schema: unknown, attemptFields: string[]): unknown {
  if (attemptFields.length === 0 || !isObject(schema) || !isObject(schema.properties)) return schema;
  const declared = Object.keys(schema.properties);
  return declared.length === attemptFields.length && attemptFields.every((name) => declared.includes(name)) ? schema : undefined;
}

/**
 * Where the run view shows the event a tool was made for: the actor's row for
 * that event when its turn holds several events, else the turn row's heading.
 * Null when the run view draws neither (another tab, or a run of more than 50
 * actors, whose Sim tab draws its constellation).
 */
function eventTargetId(actorIndex: number, turn: number, eventIndex: number): string | null {
  const ids = [`sim-event-${actorIndex}-${turn}-${eventIndex}`, `turn-row-${turn}-h`];
  return ids.find((id) => document.getElementById(id) !== null) ?? null;
}

function FieldsTable({ caption, rows, none }: { caption: string; rows: FieldRow[]; none: string }) {
  const captionId = useId();
  const [field, type, required, description] = REQUEST_WORDS.columns;
  if (rows.length === 0) {
    return (
      <div className={styles.part}>
        <p className={styles.caption} data-text="heading">{caption}</p>
        <p className={styles.quiet}>{none}</p>
      </div>
    );
  }
  // The roles are written out, so the table keeps them where it is laid out as cards.
  return (
    <table className={styles.fields} role="table" aria-labelledby={captionId}>
      <caption id={captionId} className={styles.caption} data-text="heading">{caption}</caption>
      <thead role="rowgroup">
        <tr role="row">
          {REQUEST_WORDS.columns.map((column) => (
            <th key={column} role="columnheader" scope="col">{column}</th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => (
          <tr key={row.name} role="row">
            <td role="cell" data-label={field} data-code="" translate="no">{row.name}</td>
            {row.type === null ? (
              <td role="cell" data-label={type} data-quiet="">{REQUEST_WORDS.notRecorded}</td>
            ) : (
              <td role="cell" data-label={type} data-code="" translate="no">{row.type}</td>
            )}
            <td role="cell" data-label={required}>
              {row.required === null ? '' : row.required ? REQUEST_WORDS.yes : REQUEST_WORDS.no}
            </td>
            <td role="cell" data-label={description}>{row.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Request on the run's record: the actor the tool was forged under, by its
 * tile's label and name, with its department, turn and event, beside a rule
 * in the actor's run colour; a link to that event in the run view; what the
 * tool does; and its declared input and output fields as two tables, or its
 * two schemas as JSON. The record holds no reason for a tool, so none is shown.
 */
export function RequestStation({ entry, attempt, actor, onGoToEvent }: RequestStationProps) {
  const [raw, setRaw] = useState(false);
  const doesId = useId();

  // The forge's own record where it has one; a tool known from its report alone reads its first history row.
  const source = attempt ?? entry.history[0] ?? null;
  const turn = source?.turn ?? entry.firstForgedTurn;
  const eventIndex = source?.eventIndex ?? 0;
  const department = source?.department || entry.firstForgedDepartment;
  const eventTitle = source?.eventTitle ?? '';
  const description = attempt?.description || entry.description;

  // The event is a link only where the run view draws it.
  const [targetId, setTargetId] = useState<string | null>(null);
  useEffect(() => {
    setTargetId(eventTargetId(entry.actorIndex, turn, eventIndex));
  }, [entry.actorIndex, turn, eventIndex]);

  const goTo = (e: MouseEvent<HTMLAnchorElement>) => {
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;
    e.preventDefault();
    onGoToEvent(target);
  };

  const inputNames = attempt && attempt.inputFields.length > 0 ? attempt.inputFields : entry.inputFields;
  const outputNames = attempt && attempt.outputFields.length > 0 ? attempt.outputFields : entry.outputFields;
  // The schema is the tool's first report's: it speaks for the attempt on show
  // only where it declares that attempt's fields, else the attempt's own names stand alone.
  const inputSchema = schemaFor(entry.inputSchema, attempt ? attempt.inputFields : []);
  const outputSchema = schemaFor(entry.outputSchema, attempt ? attempt.outputFields : []);
  const hasSchema = inputSchema != null || outputSchema != null;

  return (
    <div className={styles.open}>
      <div className={styles.actor} style={{ '--actor': actor.colour } as CSSProperties} data-actor-line>
        <span className={styles.rule} aria-hidden="true" data-actor-rule />
        <div className={styles.actorText}>
          <p className={styles.meta}>
            {actorLine({ label: actor.label, name: actor.name, archetype: actor.archetype, department, turn, eventTitle })}
          </p>
          {targetId && eventTitle && (
            <a className={styles.link} href={`#${targetId}`} onClick={goTo}>{goToEvent(eventTitle)}</a>
          )}
        </div>
      </div>

      <div className={styles.part}>
        <h3 id={doesId} className={styles.heading} data-text="heading">{REQUEST_WORDS.whatItDoes}</h3>
        <p className={styles.body} data-text="body">{description}</p>
      </div>

      <div className={styles.part}>
        {hasSchema && (
          <div className={styles.fieldsBar}>
            <button
              type="button"
              role="switch"
              aria-checked={raw}
              className={styles.switch}
              onClick={() => setRaw((on) => !on)}
            >
              <span className={styles.switchTrack} aria-hidden="true" />
              {REQUEST_WORDS.rawJson}
            </button>
          </div>
        )}
        {/* Raw JSON stands while a schema stands for the attempt on show; on another attempt the fields come back. */}
        {raw && hasSchema ? (
          <pre className={styles.code} translate="no" data-raw-json>
            {JSON.stringify({ input: inputSchema ?? null, output: outputSchema ?? null }, null, 2)}
          </pre>
        ) : (
          <>
            <FieldsTable caption={REQUEST_WORDS.inputFields} rows={fieldRows(inputSchema, inputNames)} none={REQUEST_WORDS.noInputFields} />
            <FieldsTable caption={REQUEST_WORDS.outputFields} rows={fieldRows(outputSchema, outputNames)} none={REQUEST_WORDS.noOutputFields} />
          </>
        )}
      </div>
    </div>
  );
}
