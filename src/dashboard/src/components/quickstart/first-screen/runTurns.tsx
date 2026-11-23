/**
 * The turns of the run Start launches, kept above the Run tab's first
 * screen, so a part of the page outside it names the same number: the How
 * it works card, which opens from every tab. The first screen tells the
 * page the number once it knows it; the number stays after the first screen
 * leaves for a run, since that run takes those turns.
 *
 * @module paracosm/dashboard/quickstart/first-screen/runTurns
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface RunTurns {
  turns: number | null;
  tell(turns: number | null): void;
}

const RunTurnsContext = createContext<RunTurns>({ turns: null, tell: () => {} });

/** Holds the turns for the page. */
export function RunTurnsProvider({ children }: { children: ReactNode }) {
  const [turns, setTurns] = useState<number | null>(null);
  const value = useMemo<RunTurns>(() => ({ turns, tell: setTurns }), [turns]);
  return <RunTurnsContext.Provider value={value}>{children}</RunTurnsContext.Provider>;
}

/** The turns of the run Start launches, or null until the first screen knows them. */
export function useRunTurns(): number | null {
  return useContext(RunTurnsContext).turns;
}

/** Tells the page the turns of the run Start launches; null while they are not known. */
export function useTellRunTurns(turns: number | null): void {
  const { tell } = useContext(RunTurnsContext);
  useEffect(() => {
    tell(turns);
  }, [tell, turns]);
}
