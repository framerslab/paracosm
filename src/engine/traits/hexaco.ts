/**
 * HEXACO trait model. The canonical six-axis personality model from
 * Ashton & Lee (PSPR 2007), the historical default for paracosm
 * leaders. Cue strings preserved verbatim from the legacy
 * `runtime/agents/cues/hexaco/translation.ts` so HEXACO scenario behavior
 * is unchanged when a leader uses this model.
 *
 * Citation:
 *   Ashton, M.C. & Lee, K. (2007). "Empirical, Theoretical, and
 *   Practical Advantages of the HEXACO Model of Personality
 *   Structure." Personality and Social Psychology Review, 11(2),
 *   150-166. doi:10.1177/1088868306294907
 *
 * @module paracosm/engine/traits/hexaco
 */

import type { TraitModel } from './index.js';

/**
 * The HEXACO axes in their canonical order. Order is preserved so
 * cue iteration matches the legacy translator's output.
 */
export const hexacoModel: TraitModel = {
  id: 'hexaco',
  name: 'HEXACO',
  description:
    'Six-factor human personality model: Honesty-Humility, Emotionality, ' +
    'Extraversion, Agreeableness, Conscientiousness, Openness. The ' +
    'historical default for paracosm leaders. Best fit for human-leader ' +
    'scenarios (CEOs, captains, governors, ship commanders, councils).',
  citation: 'Ashton & Lee, PSPR 11(2), 2007, doi:10.1177/1088868306294907',
  axes: [
    {
      id: 'emotionality',
      label: 'Emotionality',
      description: 'Tendency to experience anxiety, sentimentality, and seek emotional support.',
      lowPole: 'stays flat under stress',
      highPole: 'feels events in body before words',
    },
    {
      id: 'openness',
      label: 'Openness',
      description: 'Aesthetic sensitivity, intellectual curiosity, willingness to try unconventional approaches.',
      lowPole: 'sticks to what has worked',
      highPole: 'looks for what the moment makes possible',
    },
    {
      id: 'honestyHumility',
      label: 'Honesty-Humility',
      description: 'Sincerity, fairness, modesty, low entitlement.',
      lowPole: 'speaks strategically, not confessionally',
      highPole: 'says what they really think',
    },
    {
      id: 'conscientiousness',
      label: 'Conscientiousness',
      description: 'Organization, diligence, perfectionism, prudence.',
      lowPole: 'moves first and adjusts mid-stride',
      highPole: 'wants a plan before moving',
    },
    {
      id: 'extraversion',
      label: 'Extraversion',
      description: 'Social self-esteem, social boldness, sociability, liveliness.',
      lowPole: 'processes inward, speaks only after',
      highPole: 'says it out loud rather than sit with it',
    },
    {
      id: 'agreeableness',
      label: 'Agreeableness',
      description: 'Forgiveness, gentleness, flexibility, patience.',
      lowPole: "doesn't owe anyone smoothness right now",
      highPole: 'wants to hold the group together',
    },
  ],
  defaults: {
    emotionality: 0.5,
    openness: 0.5,
    honestyHumility: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
  },
  drift: {
    /**
     * Outcome reinforcement table. Values match the canonical
     * `outcomePullForTrait` in `src/engine/core/progression.ts` so
     * applying hexacoModel drift through the registry produces
     * byte-identical output to the legacy `driftCommanderHexaco`
     * path. Citations from the progression.ts header:
     *
     *   - Openness ↔ exploratory novelty (DeYoung 2014)
     *   - Conscientiousness ↔ risk avoidance after failure
     *     (Roberts et al 2008)
     *   - Extraversion ↔ social-presence reinforcement
     *   - Agreeableness ↔ post-conflict adjustment
     *     (Lee & Ashton 2004)
     *   - Emotionality activation under threat (Lee & Ashton 2004)
     *   - Honesty-Humility ↔ strategic behavior (Hilbig & Zettler 2009)
     */
    outcomes: {
      openness: {
        risky_success: 0.03,
        risky_failure: -0.04,
        conservative_failure: 0.02,
      },
      conscientiousness: {
        risky_failure: 0.03,
        conservative_success: 0.02,
      },
      extraversion: {
        risky_success: 0.02,
        risky_failure: -0.02,
      },
      agreeableness: {
        conservative_success: 0.02,
        risky_failure: -0.02,
      },
      emotionality: {
        risky_failure: 0.03,
        conservative_failure: 0.02,
      },
      honestyHumility: {
        risky_success: -0.02,
        conservative_success: 0.02,
      },
    },
    leaderPull: {
      emotionality: 0.05,
      openness: 0.06,
      honestyHumility: 0.04,
      conscientiousness: 0.06,
      extraversion: 0.05,
      agreeableness: 0.05,
    },
    roleActivation: {
      conscientiousness: 0.03,
      openness: 0.03,
      honestyHumility: 0.02,
      agreeableness: 0.02,
      extraversion: 0.02,
      emotionality: 0.02,
    },
  },
  /**
   * Cue strings lifted verbatim from
   * `src/runtime/agents/cues/hexaco/translation.ts` so HEXACO scenario
   * behavior is unchanged. Mid-zone is omitted intentionally: the
   * legacy translator only emits cues for polarized values.
   */
  cues: {
    emotionality: {
      low: 'you stay flat when others panic',
      high: 'you feel events in your body before words',
    },
    openness: {
      low: 'you stick to what has worked',
      high: 'you look for what this moment makes possible',
    },
    honestyHumility: {
      low: 'you speak strategically, not confessionally',
      high: 'you say what you really think',
    },
    conscientiousness: {
      low: 'you move first and adjust mid-stride',
      high: 'you want a plan before you move',
    },
    extraversion: {
      low: 'you process inward and speak only after',
      high: 'you say it out loud rather than sit with it',
    },
    agreeableness: {
      low: "you don't owe anyone smoothness right now",
      high: 'you want to hold the group together through this',
    },
  },
  recommendedProviders: ['openai', 'anthropic'],
};
