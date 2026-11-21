/**
 * The Run tab's first screen: the input phase of the Quickstart view, as a
 * first-time visitor meets it. In order: the scenario line (the scenario's
 * name, what the run does and its figures), the shared colony panel (the
 * living grid at turn 0, drawn once), the run's size in the leaders'
 * heading row, the leaders, and Start with its run line and notice.
 *
 * The run's size is the visitor's to choose on their own key or on a server
 * that is not the hosted demo, and the address holds it; a run on the
 * host's keys is a pair. Every part is written for that one size.
 *
 * The parts kept from the earlier screen (the launch error, the replay link,
 * the scenario and paste forms and the digital twin card) come in as
 * children and stand after the first screen, outside its root, until each
 * is rebuilt to the first screen's figures and moved inside it.
 *
 * @module paracosm/dashboard/quickstart/first-screen/RunFirstScreen
 */
import { useState, type ReactNode } from 'react';
import { payer, readLaunchSettings, safeLocalStorage } from './effectiveLaunch';
import { LeaderPair } from './LeaderPair';
import { RunSize } from './RunSize';
import { FREE_SIZE, sizeMode } from './runSize.helpers';
import { ScenarioLine } from './ScenarioLine';
import { SharedColonyPanel } from './SharedColonyPanel';
import { StartBand, type StartRun } from './StartBand';
import { ServerFactsProvider, useServerFacts } from './useServerFacts';
import { useRunSetup } from './useRunSetup';
import styles from './RunFirstScreen.module.scss';

export interface RunFirstScreenProps {
  /** Starts the run Start launches. */
  onStart: StartRun;
  /** The kept parts of the earlier screen, shown after the first screen. */
  children?: ReactNode;
}

function FirstScreen({ onStart }: { onStart: StartRun }) {
  const facts = useServerFacts();
  const { size, setSize } = useRunSetup();
  // From Start's press until the run opens or fails, the size cannot change.
  const [starting, setStarting] = useState(false);

  // Read on each render: the Settings tab may have saved a key since.
  const settings = readLaunchSettings(safeLocalStorage());
  const who = payer(facts, settings.overrides);
  const mode = sizeMode({ payer: who, adminConfig: facts.adminConfig.status, rateLimit: facts.rateLimit.status });
  // A run that is not the visitor's to size is a pair, whatever the address says.
  const runSize = mode === 'pair' ? FREE_SIZE : size;

  return (
    <div className={styles.screen} data-testid="run-first-screen">
      <ScenarioLine size={runSize} />
      <SharedColonyPanel size={runSize} />
      <RunSize size={size} onSize={setSize} locked={starting} />
      <LeaderPair size={runSize} />
      <StartBand size={runSize} onStart={onStart} onBusy={setStarting} />
    </div>
  );
}

export function RunFirstScreen({ onStart, children }: RunFirstScreenProps) {
  return (
    <ServerFactsProvider>
      <FirstScreen onStart={onStart} />
      {children}
    </ServerFactsProvider>
  );
}
