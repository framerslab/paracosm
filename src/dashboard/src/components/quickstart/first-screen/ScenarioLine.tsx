/**
 * The scenario line, the first block of the Run tab: the mark SCENARIO over
 * the scenario's name, the page's one h1; three sentences that say what the
 * AI leaders do, what Start does and what ends the run; and one line of the
 * run's own figures as the run will use them.
 *
 * Until GET /scenario has answered, and the server has said whose keys a
 * free run uses, the block draws shapes of its final size, so the page never
 * paints the fallback scenario's name and the words replace the shapes
 * without moving anything. A scenario that did not load is said beside the
 * broken-link mark with a Try now key, while the page keeps asking.
 *
 * While no free run is left on the host's keys and Start is replaced, the
 * middle sentence, which names Start, is left out: the limit is said once,
 * with the key that takes Start's place.
 *
 * @module paracosm/dashboard/quickstart/first-screen/ScenarioLine
 */
import { Fragment, useState } from 'react';
import { useScenarioContext, useScenarioLoad, useScenarioReady } from '../../../App';
import { BrokenLinkMark, SectionMark } from './marks';
import {
  effectiveDepartments,
  effectivePeople,
  effectiveTurns,
  eventsPerTurn,
  figureParts,
  figuresSpoken,
  payer,
  readLaunchSettings,
  safeLocalStorage,
  type RunFigures,
} from './effectiveLaunch';
import { useOnline } from './useOnline';
import { noFreeRunLeft, useServerFacts } from './useServerFacts';
import {
  LOADING_NAME,
  SCENARIO_MARK,
  scenarioError,
  scenarioOffline,
  scenarioSentences,
  tryNow,
  trying as tryingWords,
} from './words';
import styles from './ScenarioLine.module.scss';

/** The figures the loading shapes are drawn over: a free run's, about as long as any run's. */
const LOADING_FIGURES: RunFigures = { people: 30, departments: 3, turns: 6, events: 2 };

/** The figures as a grid of cells on a phone and one line from the tablet up, read as one sentence. */
function Figures({ figures, loading }: { figures: RunFigures; loading: boolean }) {
  const parts = figureParts(figures);
  const cells = (
    <span className={styles.cells} aria-hidden="true" data-testid={loading ? undefined : 'scenario-figures'}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className={styles.dot}> · </span>}
          {loading
            ? <span className={styles.cell}><span className={styles.shape} data-shape>{part}</span></span>
            : <span className={styles.cell} data-figure>{part}</span>}
        </Fragment>
      ))}
    </span>
  );
  return (
    <p className={styles.figures}>
      {!loading && <span className="sr-only">{figuresSpoken(figures)}</span>}
      {cells}
    </p>
  );
}

export interface ScenarioLineProps {
  /** How many leaders the run takes: a pair ends in a verdict, 3 to 300 in a report. */
  size?: number;
}

export function ScenarioLine({ size = 2 }: ScenarioLineProps) {
  const scenario = useScenarioContext();
  const ready = useScenarioReady();
  const { failed, retryNow } = useScenarioLoad();
  const facts = useServerFacts();
  const online = useOnline();
  const [retrying, setRetrying] = useState(false);

  // Read on each render: the Settings tab may have saved a key since.
  const settings = readLaunchSettings(safeLocalStorage());
  const who = payer(facts, settings.overrides);
  // Whose keys a run uses is known once the visitor holds a key or the server has said whether it is the hosted demo.
  const payerKnown = who === 'own' || facts.adminConfig.status !== 'loading';
  const figuresKnown = who === 'own' || typeof facts.adminConfig.hostedDemo === 'boolean';

  const mark = (
    <p className={styles.mark} aria-hidden="true" data-row="scenario mark" data-testid="scenario-mark">
      <SectionMark className={styles.triangle} />
      <span>{SCENARIO_MARK}</span>
    </p>
  );

  if (!ready && failed) {
    const press = () => {
      if (retrying) return;
      setRetrying(true);
      void retryNow().finally(() => setRetrying(false));
    };
    return (
      <section className={styles.line} data-testid="scenario-line">
        <div className={styles.title}>{mark}</div>
        <div className={styles.failure}>
          <BrokenLinkMark className={styles.brokenLink} />
          <p role="status" className={styles.failureText} data-text="body">
            {online ? scenarioError : scenarioOffline}
          </p>
          <button
            type="button"
            className={styles.tryNow}
            onClick={press}
            aria-disabled={retrying ? 'true' : undefined}
          >
            {retrying ? tryingWords : tryNow}
          </button>
        </div>
      </section>
    );
  }

  if (!ready || !payerKnown) {
    return (
      <section className={styles.line} data-testid="scenario-line" aria-busy="true" data-loading>
        <div className={styles.title} aria-hidden="true">
          <p className={styles.mark}><span className={styles.shape} data-shape>{SCENARIO_MARK}</span></p>
          <p className={styles.heading}><span className={styles.shape} data-shape>{LOADING_NAME}</span></p>
        </div>
        <div className={styles.body} aria-hidden="true">
          <p className={styles.sentences}>
            <span className={styles.shape} data-shape>
              {scenarioSentences({ n: size, turns: LOADING_FIGURES.turns, atLimit: false })}
            </span>
          </p>
          <Figures figures={LOADING_FIGURES} loading />
        </div>
      </section>
    );
  }

  const turns = effectiveTurns(facts, scenario, settings, who);
  const atLimit = who === 'host' && noFreeRunLeft(facts);
  const figures: RunFigures = {
    people: effectivePeople(facts, scenario, who),
    departments: effectiveDepartments(facts, scenario, who),
    turns,
    events: eventsPerTurn(scenario),
  };
  return (
    <section className={styles.line} data-testid="scenario-line">
      <div className={styles.title}>
        {mark}
        <h1 className={styles.heading} data-text="heading">{scenario.labels.name}</h1>
      </div>
      <div className={styles.body}>
        <p className={styles.sentences} data-text="body" data-testid="scenario-sentences">
          {scenarioSentences({ n: size, turns, atLimit })}
        </p>
        {figuresKnown && <Figures figures={figures} loading={false} />}
      </div>
    </section>
  );
}
