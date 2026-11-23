/**
 * The executor an emergent engine runs forged code with.
 *
 * AgentOS's `EmergentCapabilityEngine` hands every test case and every call
 * of a forged tool to the `SandboxedToolForge` it builds, and that forge
 * runs the code on its `executor`. The engine offers no accessor for either
 * (AgentOS 0.19.0), so this reads the forge the engine built.
 */
import type { EmergentCapabilityEngine, ForgedCodeExecutor } from '@framers/agentos';

/** The executor `engine` runs every forged tool's code with. */
export function engineExecutor(engine: EmergentCapabilityEngine): ForgedCodeExecutor {
  const forge = (engine as unknown as { sandboxForge?: { executor?: ForgedCodeExecutor } }).sandboxForge;
  if (!forge?.executor) {
    throw new Error('the engine holds no sandbox forge with an executor');
  }
  return forge.executor;
}
