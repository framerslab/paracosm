/**
 * The Run tab's first screen: the input phase of the Quickstart view, as a
 * first-time visitor meets it. In order: the scenario line (the scenario's
 * name, what the run does and its figures), the shared colony panel (the
 * living grid at turn 0, drawn once), the run's size in the leaders'
 * heading row, the note that the leaders are fictional, the leaders, the AI
 * and adults notes, Start with its run line and notice, the other scenarios,
 * and Write your own scenario. The page's foot ends the tab.
 *
 * The run's size is the visitor's to choose on their own key or on a server
 * that is not the hosted demo, and the address holds it; a run on the
 * host's keys is a pair. Every part is written for that one size.
 *
 * A draft of 200 characters or more in Write your own scenario holds Start,
 * which links to the draft and can clear it.
 *
 * The screen tells the page the run's turns, which the How it works card
 * names from any tab.
 *
 * The parts kept from the earlier screen (the launch error, the replay link
 * and the digital twin card) come in as children and stand after the first
 * screen, outside its root, until each is rebuilt to the first screen's
 * figures and moved inside it.
 *
 * @module paracosm/dashboard/quickstart/first-screen/RunFirstScreen
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useScenarioContext, useScenarioReady } from '../../../App';
import { readPromptFromUrl, SeedInput, type SeedInputProps } from '../SeedInput';
import { effectiveTurns, payer, readLaunchSettings, safeLocalStorage } from './effectiveLaunch';
import { FictionalNote, FirstScreenNotes } from './FirstScreenNotes';
import { formatResetTime } from './launchFailure';
import { LeaderPair } from './LeaderPair';
import { OtherScenarios } from './OtherScenarios';
import { PageFoot } from './PageFoot';
import { RunSize } from './RunSize';
import { useTellRunTurns } from './runTurns';
import { FREE_SIZE, sizeMode } from './runSize.helpers';
import { ScenarioLine } from './ScenarioLine';
import { SharedColonyPanel } from './SharedColonyPanel';
import { StartBand, type StartRun } from './StartBand';
import { noFreeRunLeft, ServerFactsProvider, useServerFacts } from './useServerFacts';
import { useRunSetup } from './useRunSetup';
import { WRITE_YOUR_OWN } from './words';
import styles from './RunFirstScreen.module.scss';

/** The shortest draft the paste form takes: a draft this long holds Start. */
const DRAFT_HOLDS_AT = 200;

export interface RunFirstScreenProps {
  /** Starts the run Start launches. */
  onStart: StartRun;
  /** Compiles and runs the scenario written in Write your own scenario. */
  onSeedReady: SeedInputProps['onSeedReady'];
  /** The kept parts of the earlier screen, shown after the first screen. */
  children?: ReactNode;
}

function FirstScreen({ onStart, onSeedReady }: Pick<RunFirstScreenProps, 'onStart' | 'onSeedReady'>) {
  const facts = useServerFacts();
  const scenario = useScenarioContext();
  const scenarioReady = useScenarioReady();
  const { size, setSize } = useRunSetup();
  // From Start's press until the run opens or fails, the size cannot change,
  // no other scenario loads and the paste form starts no second run.
  const [starting, setStarting] = useState(false);
  // The paste form's draft, held here so Start can wait for it.
  const [draft, setDraft] = useState(readPromptFromUrl);
  const goToDraft = useRef<() => void>(() => undefined);
  const registerGoToDraft = useCallback((go: () => void) => { goToDraft.current = go; }, []);

  // Read on each render: the Settings tab may have saved a key since.
  const settings = readLaunchSettings(safeLocalStorage());
  const who = payer(facts, settings.overrides);
  const mode = sizeMode({ payer: who, adminConfig: facts.adminConfig.status, rateLimit: facts.rateLimit.status });
  // A run that is not the visitor's to size is a pair, whatever the address says.
  const runSize = mode === 'pair' ? FREE_SIZE : size;
  // The run's turns, for the How it works card, once the scenario has loaded
  // and the server has said whose keys a run uses: the scenario line's rule.
  const payerKnown = who === 'own' || facts.adminConfig.status !== 'loading';
  useTellRunTurns(scenarioReady && payerKnown ? effectiveTurns(facts, scenario, settings, who) : null);

  // No free run left on the host's keys: the paste form says so above its key, with the reset time.
  const resetAt = facts.rateLimit.status === 'ready' ? facts.rateLimit.answer?.resetAt : undefined;
  const atLimit = who === 'host' && noFreeRunLeft(facts)
    ? { resetTime: resetAt === undefined ? undefined : formatResetTime(resetAt) || undefined }
    : null;
  const held = draft.trim().length >= DRAFT_HOLDS_AT
    ? { onGo: () => goToDraft.current(), onClear: () => setDraft('') }
    : null;

  return (
    <div className={styles.screen} data-testid="run-first-screen">
      <ScenarioLine size={runSize} />
      <SharedColonyPanel size={runSize} />
      <RunSize size={size} onSize={setSize} locked={starting} />
      <FictionalNote />
      <LeaderPair size={runSize} />
      <FirstScreenNotes />
      <StartBand size={runSize} onStart={onStart} onBusy={setStarting} draft={held} />
      <OtherScenarios locked={starting} />
      <section className={styles.writeYourOwn} data-testid="write-your-own" aria-labelledby="write-your-own-heading">
        <h2 className={styles.heading} id="write-your-own-heading" data-text="heading">{WRITE_YOUR_OWN}</h2>
        <SeedInput
          variant="pasteOnly"
          locked={starting}
          payer={who}
          atLimit={atLimit}
          onSeedReady={onSeedReady}
          seedText={draft}
          onSeedTextChange={setDraft}
          registerGoToDraft={registerGoToDraft}
        />
      </section>
    </div>
  );
}

export function RunFirstScreen({ onStart, onSeedReady, children }: RunFirstScreenProps) {
  return (
    <ServerFactsProvider>
      <FirstScreen onStart={onStart} onSeedReady={onSeedReady} />
      {children}
      <PageFoot />
    </ServerFactsProvider>
  );
}
