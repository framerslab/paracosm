/**
 * The Run tab's first screen: the input phase of the Quickstart view, as a
 * first-time visitor meets it. In order: the scenario line (the scenario's
 * name, what the run does and its figures), the shared colony panel (the
 * living grid at turn 0, drawn once), and the leaders.
 *
 * The parts kept from the earlier screen (the launch error, the replay link,
 * the scenario and paste forms and the digital twin card) come in as
 * children and stand after the first screen, outside its root, until each
 * is rebuilt to the first screen's figures and moved inside it.
 *
 * @module paracosm/dashboard/quickstart/first-screen/RunFirstScreen
 */
import type { ReactNode } from 'react';
import { LeaderPair } from './LeaderPair';
import { ScenarioLine } from './ScenarioLine';
import { SharedColonyPanel } from './SharedColonyPanel';
import { ServerFactsProvider } from './useServerFacts';
import styles from './RunFirstScreen.module.scss';

export interface RunFirstScreenProps {
  /** The kept parts of the earlier screen, shown after the first screen. */
  children?: ReactNode;
}

export function RunFirstScreen({ children }: RunFirstScreenProps) {
  return (
    <ServerFactsProvider>
      <div className={styles.screen} data-testid="run-first-screen">
        <ScenarioLine />
        <SharedColonyPanel />
        <LeaderPair />
      </div>
      {children}
    </ServerFactsProvider>
  );
}
