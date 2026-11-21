/**
 * Who pays for a model call on the hosted demo, and where the call goes.
 * Every route of the dashboard server that makes model calls asks
 * {@link hostedModelRouting} once per request and runs every call of that
 * request as it answers.
 *
 * On the hosted demo (`PARACOSM_HOSTED_DEMO=true`):
 *
 * - A request that brings a provider key of its own runs on that key's
 *   provider and that key. With both keys it runs on the provider it names.
 * - A request that brings none runs on the host's keys, on OpenAI
 *   (`DEMO_PROVIDER`) with the demo's OpenAI models, whatever provider it
 *   names. A host that holds no OpenAI key refuses it (503), whatever other
 *   key it holds, before any limit counts it.
 * - Either way no call falls back to another provider: each one carries
 *   `stayOnProvider`, which passes `fallbackProviders: []` to AgentOS and
 *   never swaps a provider with no key for another provider's key.
 *
 * A key the server reads as no key (blank, or a masked value such as
 * `sk-...`, see `normalizeCredential`) is no key here too.
 *
 * Off the hosted demo (a local server, the npm package's dashboard) none of
 * this applies: {@link hostedModelRouting} returns null and every route
 * keeps the routing its request and the environment give it.
 *
 * @module paracosm/server/hosted-model-policy
 */
import type { LlmProvider, SimulationModelConfig } from '../engine/types.js';
import {
  hasProviderCredentials,
  normalizeCredential,
  resolveProviderFromCredentials,
  type ProviderCredentialOptions,
} from '../engine/provider/credentials.js';
import { DEMO_PROVIDER, demoEconomics } from '../cli/sim-config.js';

/** What a host-paid request is told on a hosted demo whose host holds no OpenAI key. */
export const HOSTED_NO_OPENAI_KEY_ERROR =
  'This demo runs on OpenAI and has no OpenAI key. Add your own OpenAI or Anthropic key in Settings to run.';

/** The routing of one hosted-demo request's model calls. */
export type HostedModelRouting =
  | {
      /** The request's own key pays. */
      payer: 'visitor';
      provider: LlmProvider;
      /** The request's OpenAI key, when it brought one. */
      apiKey?: string;
      /** The request's Anthropic key, when it brought one. */
      anthropicKey?: string;
      stayOnProvider: true;
    }
  | {
      /** The host's environment key pays. */
      payer: 'host';
      provider: LlmProvider;
      stayOnProvider: true;
    }
  | {
      /** Refused before any model call or limit: the host cannot pay on OpenAI. */
      payer: 'refused';
      status: 503;
      error: string;
    };

/** What {@link hostedModelRouting} reads. */
export interface HostedModelRoutingInput {
  /** True on the hosted demo (`serverMode === 'hosted_demo'`). */
  hostedDemo: boolean;
  /** The server's environment, which holds the host's keys. */
  env: NodeJS.ProcessEnv;
  /** The provider keys the request brought, as it sent them. */
  credentials: ProviderCredentialOptions;
  /** The provider the request names, if any. A host-paid request runs on OpenAI whatever it names. */
  requestedProvider?: LlmProvider;
}

/**
 * The routing of one request's model calls on the hosted demo, or null off
 * the hosted demo, where a route keeps its own routing.
 */
export function hostedModelRouting(input: HostedModelRoutingInput): HostedModelRouting | null {
  if (!input.hostedDemo) return null;
  const apiKey = normalizeCredential(input.credentials.apiKey);
  const anthropicKey = normalizeCredential(input.credentials.anthropicKey);
  if (hasProviderCredentials({ apiKey, anthropicKey })) {
    return {
      payer: 'visitor',
      provider: resolveProviderFromCredentials(input.requestedProvider, { apiKey, anthropicKey }, DEMO_PROVIDER),
      ...(apiKey ? { apiKey } : {}),
      ...(anthropicKey ? { anthropicKey } : {}),
      stayOnProvider: true,
    };
  }
  if (!normalizeCredential(input.env.OPENAI_API_KEY)) {
    return { payer: 'refused', status: 503, error: HOSTED_NO_OPENAI_KEY_ERROR };
  }
  return { payer: 'host', provider: DEMO_PROVIDER, stayOnProvider: true };
}

/**
 * The models of a host-paid run on the hosted demo: those a host-paid
 * /setup run plays (`applyDemoCaps`), which a host-paid Digital Twin or
 * /simulate run takes too.
 */
export function hostedRunModels(): SimulationModelConfig {
  return { ...demoEconomics(DEMO_PROVIDER).models };
}
