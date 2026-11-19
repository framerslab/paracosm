import { NOT_RECORDED } from '../forgeWords';

/** The one line of Code or Tests on a forge with no trace: the run did not record it. */
export function NotRecorded({ station }: { station: keyof typeof NOT_RECORDED }) {
  return <>{NOT_RECORDED[station]}</>;
}
