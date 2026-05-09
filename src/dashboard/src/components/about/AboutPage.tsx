import type { CSSProperties } from 'react';
import { useScenarioContext } from '../../App';
import { describeAvailability, type ProductAvailability } from './aboutStatus';
import styles from './AboutPage.module.scss';

interface FaqItem {
  q: string;
  a: string;
}

const FAQ: FaqItem[] = [
  {
    q: 'What is Paracosm?',
    a: 'Paracosm is an agent swarm simulation framework for structured world modeling with LLMs. Start from a prompt, brief, URL, or scenario JSON draft, compile or ground it into a typed ScenarioPackage, then assign AI leaders with distinct HEXACO personality profiles. The engine handles event generation, department analysis, runtime tool forging, personality drift, and deterministic state transitions. Leaders can be colony commanders, CEOs, generals, governing councils, AI systems, or any top-down decision maker — each running a multi-agent swarm of specialists and ~100 personality-typed cells.',
  },
  {
    q: 'How does the simulation work?',
    a: 'AI leaders with distinct personality profiles run the same world in parallel. Each turn: an Event Director generates events based on the world state and decision history. Department agents analyze the situation and forge computational tools at runtime. Leaders decide. The deterministic kernel applies consequences. Same seed, same starting conditions, different leaders, different outcomes. Leaders are abstract: they can model people, organizations, policies, or autonomous systems.',
  },
  {
    q: 'How do I inspect the agent swarm?',
    a: 'Every turn-loop run produces a swarm of ~100 named agents with departments, roles, family edges, mood, and short-term memory. Read it from RunArtifact.finalSwarm, import helpers from paracosm/swarm (getSwarm, swarmByDepartment, swarmFamilyTree, moodHistogram, departmentHeadcount, aliveCount, deathCount), or fetch GET /api/v1/runs/:runId/swarm for the lightweight HTTP version. The Library tab streams the same swarm data live during a run for the dashboard visualization.',
  },
  {
    q: 'How much does Paracosm cost?',
    a: 'The core engine, Mars Genesis and Lunar Outpost scenarios, CLI, dashboard, and batch runner are free and open source under the Apache-2.0 license today. Pro ($49/mo), Enterprise ($499/mo), and Platform are planned hosted tiers. They are roadmap packages, not generally available products yet.',
  },
  {
    q: 'What is the Scenario Compiler?',
    a: 'The Scenario Compiler is the zero-code authoring path for Paracosm: a scenario JSON draft plus optional prompt, brief, or URL grounding generates runtime hooks via LLM calls instead of hand-written TypeScript. It already works in the open-source CLI and local dashboard today. A prompt-only wrapper should generate the same typed contract before simulation; the polished hosted self-serve product surface is still planned rather than generally available.',
  },
  {
    q: 'How many simulations can I run?',
    a: 'The hosted demo at paracosm.sh rate-limits to 3 simulations per IP per day when using the server API keys. Add your own OpenAI or Anthropic key in Settings to remove the rate limit and run unlimited simulations. When running locally with the open-source CLI, there is no rate limit at all.',
  },
  {
    q: 'What scenarios are available?',
    a: 'Mars Genesis (100-colonist Mars colony over 50 years) is the flagship. Lunar Outpost (50-person crew at the lunar south pole) proves the engine works with different departments, progression, and milestones. The engine is designed to support broader closed-state, turn-based simulations such as Antarctic stations, orbital habitats, submarines, generation ships, corporate scenarios, and defense wargames, with scenario authoring expanding over time.',
  },
  {
    q: 'What can leaders represent?',
    a: 'Leaders are abstract top-down decision makers. They can be colony commanders, CEOs, military generals, governing councils, AI systems, department heads, or any entity that receives information and makes choices. The engine does not care what they represent. It models how their HEXACO personality profile shapes decisions under pressure. Run two CEOs with different risk appetites through the same market crisis. Run two generals through the same theater. Run two AI policies through the same failure cascade.',
  },
  {
    q: 'What verticals does Paracosm support?',
    a: 'Defense and intelligence (wargaming, scenario planning), corporate strategy (acquisition simulation, leadership modeling), game studios (procedural NPC civilizations, emergent narratives), academic research (controlled experiments in AI decision-making), government (policy impact simulation), and any domain where testing decisions before making them has value.',
  },
  {
    q: 'What is the Event Director?',
    a: 'The Event Director is an LLM agent that observes world state, resource levels, population, decision history, and tool intelligence from previous turns. It generates unique events per timeline: crises, opportunities, disruptions, transitions. Events test weaknesses, exploit consequences of prior decisions, and escalate over time. No two runs play the same way.',
  },
  {
    q: 'What are promotions?',
    a: 'At turn 0, before any events occur, each leader evaluates the full agent roster and promotes department heads. Medical gets a Chief Medical Officer, Engineering gets a Chief Engineer, and so on. The leader picks based on personality fit, specialization, and experience. A bold leader picks unconventional candidates. A cautious leader picks proven specialists. This matters because promoted agents become the department analysis LLM agents for the rest of the simulation. Their personality colors every report they produce, which shapes the information the leader sees, which shapes decisions. The leader never analyzes events directly. They only read department reports and decide.',
  },
  {
    q: 'How does a turn work?',
    a: 'Each turn is a time period (configurable, default ~4 years). The Event Director generates an event. The kernel advances time (births, deaths, aging). All department heads analyze the event in parallel, forging tools and citing research. The leader reads all reports and decides. The kernel classifies the outcome and applies effects. All alive agents react in parallel. Reactions become persistent memories. Personality traits drift. Then the next turn begins with the world changed by everything that happened.',
  },
  {
    q: 'What is runtime tool forging?',
    a: 'Department agents create computational tools on the fly: radiation dose calculators, food security projectors, structural analyzers, morale prediction models. Each tool runs in a hardened node:vm sandbox, is reviewed by an LLM-as-judge for safety and correctness, and produces real computed output that influences decisions. Nobody pre-programmed these tools.',
  },
  {
    q: 'What is HEXACO personality?',
    a: 'HEXACO is a six-factor personality model from psychology research: Honesty-Humility, Emotionality, Extraversion, Agreeableness, Conscientiousness, and Openness to Experience. Each trait is a continuous 0-1 value, not a categorical type. Traits drift over time through leader pull, role pull, and outcome reinforcement, producing measurably different behavior across turns.',
  },
  {
    q: 'Is the simulation deterministic?',
    a: 'The kernel is fully deterministic. Same seed produces the same roster, progressions, and state transitions via a seeded PRNG (Mulberry32). The divergence comes entirely from AI-driven decisions: different leaders make different choices, which the Event Director responds to with different events.',
  },
  {
    q: 'Can I create my own scenario?',
    a: 'Two ways. Write a ScenarioPackage in TypeScript with full control over hooks and progression logic today. Or use the Scenario Compiler from the open-source CLI or local dashboard to turn JSON into a runnable scenario package. Hosted self-serve packaging for that workflow is still planned rather than broadly available.',
  },
  {
    q: 'What is AgentOS?',
    a: 'AgentOS is the open-source TypeScript runtime that powers Paracosm. It provides the agent() function, generateText(), EmergentCapabilityEngine for tool forging, EmergentJudge for safety review, and AgentMemory for semantic research retrieval. Paracosm is built entirely on the AgentOS API.',
  },
  {
    q: 'What LLM providers are supported?',
    a: 'OpenAI (GPT-5.4, GPT-5.4-mini) and Anthropic (Claude Sonnet 4.6, Claude Haiku 4.5) are supported. Different models can be assigned to different roles: commander, departments, judge, and crisis director. The simulation adapts its API calls to whichever provider you configure.',
  },
  {
    q: 'Is this open source or commercial?',
    a: 'Both, but at different maturity levels. The core engine is open source under Apache-2.0 and usable today. The hosted and enterprise layers are the commercial roadmap: auth, persistence, exports, orchestration, private deployment, and white-label packaging built on top of the open core.',
  },
  {
    q: 'Can I white-label Paracosm for my organization?',
    a: 'That is the intended direction for the future Platform tier. White-label branding, custom domains, and customer-owned dashboard theming are not publicly available today.',
  },
];

interface PricingTier {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: { label: string; href: string };
  highlight?: boolean;
  availability: ProductAvailability;
}

const PRICING: PricingTier[] = [
  {
    name: 'Open Source',
    price: 'Free',
    period: 'forever',
    description: 'The full engine, two scenarios, CLI, dashboard, and batch runner.',
    features: [
      'Paracosm engine (Apache-2.0)',
      'Mars Genesis + Lunar Outpost scenarios',
      'React dashboard with live SSE streaming',
      'Batch runner for multi-scenario experiments',
      'TypeScript SDK with full type definitions',
      'Community support via Discord',
    ],
    cta: { label: 'View on GitHub', href: 'https://github.com/framersai/paracosm' },
    availability: 'available_now',
  },
  {
    name: 'Pro',
    price: '$49',
    period: '/month',
    description: 'Planned hosted convenience tier for auth, persistence, API access, and zero-code workflows.',
    features: [
      'Target tier, not generally available yet',
      'Hosted auth + dashboard',
      'Persistent run history + replay',
      'Basic remote execution API',
      'JSON export baseline',
      'Scenario Compiler workflow',
      'Expanded reporting over time',
    ],
    cta: { label: 'Join Early Access', href: 'mailto:team@frame.dev?subject=Paracosm Pro Early Access' },
    availability: 'planned',
  },
  {
    name: 'Enterprise',
    price: '$499',
    period: '/month + usage',
    description: 'Fleet orchestration, distributed parallelization, and private deployment for organizations running simulations at scale.',
    features: [
      'Target tier, not generally available yet',
      'Run 10-100+ leaders in parallel per scenario',
      'Distributed worker nodes for fleet orchestration',
      'Private deployment (self-hosted or cloud-managed)',
      'Workspace / org model with SSO / SAML + RBAC',
      'Audit trails with provenance persistence',
      'Dedicated support / SLA packaging',
    ],
    cta: { label: 'Contact Sales', href: 'mailto:team@frame.dev?subject=Paracosm Enterprise Inquiry' },
    highlight: true,
    availability: 'design_partners',
  },
  {
    name: 'Platform',
    price: 'Custom',
    period: 'pricing',
    description: 'Longer-term platform package for orchestration, white-label, and marketplace distribution.',
    features: [
      'Future roadmap tier',
      'White-label domains and branding',
      'Parallel run orchestration',
      'Webhook ecosystem',
      'Bring-your-own-model integrations',
      'Scenario marketplace + billing flows',
      'Dedicated infrastructure',
    ],
    cta: { label: 'Contact Sales', href: 'mailto:team@frame.dev?subject=Paracosm Platform Inquiry' },
    availability: 'future_roadmap',
  },
];

interface ProductSurfaceCard {
  title: string;
  availability: ProductAvailability;
  description: string;
}

const PRODUCT_SURFACES: ProductSurfaceCard[] = [
  {
    title: 'Open-source engine',
    availability: 'available_now',
    description: 'Core simulation runtime, Mars + Lunar scenarios, CLI, batch runner, and dashboard.',
  },
  {
    title: 'Scenario Compiler',
    availability: 'local_build',
    description: 'JSON-to-runtime authoring path that already works in the CLI and local dashboard.',
  },
  {
    title: 'Hosted demo API',
    availability: 'early_access',
    description: 'Rate-limited shared demo infrastructure for quick runs before you bring your own keys.',
  },
  {
    title: 'Enterprise orchestration',
    availability: 'design_partners',
    description: 'Private deployment, large parallel fleets, governance, and org controls for serious operators.',
  },
  {
    title: 'White-label platform',
    availability: 'future_roadmap',
    description: 'Marketplace, branding, custom domains, and commercial distribution packaging.',
  },
];

const AVAILABILITY_TONE_STYLES: Record<ReturnType<typeof describeAvailability>['tone'], { color: string; background: string; border: string }> = {
  green: { color: 'var(--green)', background: 'rgba(106,173,72,.10)', border: 'rgba(106,173,72,.35)' },
  teal: { color: 'var(--teal)', background: 'rgba(90,191,173,.10)', border: 'rgba(90,191,173,.35)' },
  amber: { color: 'var(--amber)', background: 'rgba(218,165,32,.10)', border: 'rgba(218,165,32,.35)' },
  rust: { color: 'var(--rust)', background: 'rgba(224,101,48,.10)', border: 'rgba(224,101,48,.35)' },
};

function pillStyleVars(tone: { color: string; background: string; border: string }): CSSProperties {
  return {
    '--pill-color': tone.color,
    '--pill-bg': tone.background,
    '--pill-border': tone.border,
  } as CSSProperties;
}

export function AboutPage() {
  const scenario = useScenarioContext();
  const surfaces = PRODUCT_SURFACES.map(surface => ({ ...surface, status: describeAvailability(surface.availability) }));
  const availableSurfaces = surfaces.filter(surface => surface.status.group === 'available');
  const roadmapSurfaces = surfaces.filter(surface => surface.status.group === 'roadmap');

  return (
    <div className={`about-content ${styles.page}`}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <h1 className={styles.h1}>
            PARA<span className={styles.h1Accent}>COSM</span>
          </h1>
          <p className={styles.lead}>
            Agent swarm simulation framework for structured world modeling with LLMs. Start from a prompt, brief, URL,
            or scenario JSON draft, compile or ground it into a typed world contract, then assign AI leaders with
            distinct personalities running multi-agent swarms of specialists and personality-typed cells. Watch their
            decisions compound into divergent outcomes from identical starting conditions. Leaders can be commanders,
            CEOs, generals, councils, AI systems, or any top-down decision maker. The engine handles event generation,
            department analysis, tool forging, personality drift, and state transitions. Currently running:
            <strong className={styles.leadStrong}>{scenario.labels.name}</strong>.
          </p>
          <p className={styles.leadSecondary}>
            Availability note: the open-source engine is available now. Hosted Pro, Enterprise, and Platform offerings shown below are roadmap tiers and early-access packaging, not generally available SaaS products yet.
          </p>
        </header>

        <section className={styles.section} aria-labelledby="surface-heading">
          <h2 id="surface-heading" className={styles.h2}>Product Surface</h2>
          <div className={`responsive-grid-2 ${styles.grid2WithBottom}`}>
            {[{ title: 'Use Today', items: availableSurfaces }, { title: 'Roadmap', items: roadmapSurfaces }].map(group => (
              <div key={group.title} className={styles.surfaceGroup}>
                <div className={styles.surfaceGroupLabel}>{group.title}</div>
                <div className={styles.surfaceList}>
                  {group.items.map(item => {
                    const tone = AVAILABILITY_TONE_STYLES[item.status.tone];
                    return (
                      <article key={item.title} className={styles.surfaceItem}>
                        <div className={styles.surfaceItemHead}>
                          <h3 className={styles.surfaceItemTitle}>{item.title}</h3>
                          <span className={styles.statusPill} style={pillStyleVars(tone)}>
                            {item.status.label}
                          </span>
                        </div>
                        <p className={styles.surfaceItemDescription}>{item.description}</p>
                        <p className={styles.surfaceItemDetail}>{item.status.detail}</p>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className={styles.section} aria-labelledby="how-heading">
          <h2 id="how-heading" className={styles.h2}>How It Works</h2>
          <div className={`responsive-grid-2 ${styles.grid2}`}>
            {[
              { title: 'Event Director', desc: 'AI generates unique events per timeline based on world state, decision history, and tool intelligence. No two runs play the same way.' },
              { title: 'Abstract Leaders', desc: 'Leaders are top-down decision makers with HEXACO personality profiles. They can be people, organizations, policies, or autonomous systems. The engine models how personality shapes decisions.' },
              { title: 'Tool Forging', desc: 'Department agents create computational tools at runtime: calculators, projectors, analyzers. An LLM judge reviews each for safety and correctness in a hardened node:vm sandbox.' },
              { title: 'Personality Drift', desc: 'HEXACO traits evolve through leader pull, role activation, and outcome reinforcement. A cautious leader becomes bolder after risky successes. A bold leader retreats after failures.' },
              { title: 'Deterministic Kernel', desc: 'Seeded PRNG ensures reproducibility. Same seed, same roster. Only AI decisions create divergence. Fork at any turn to explore alternate timelines.' },
              { title: 'Any Domain', desc: 'Space colonies, corporate strategy, military wargaming, policy simulation, game worlds. Define departments, metrics, and events in JSON. The engine handles the rest.' },
            ].map(item => (
              <div key={item.title} className={`hover-glow ${styles.howCard}`}>
                <h3 className={styles.howCardTitle}>{item.title}</h3>
                <p className={styles.howCardDesc}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Enterprise / scalability banner */}
        <section className={styles.section} aria-labelledby="hosted-heading">
          <div className={styles.hostedBanner}>
            <div className={styles.hostedLabel}>Open Core + Hosted Roadmap</div>
            <h3 id="hosted-heading" className={styles.hostedTitle}>Planned Hosted Packaging</h3>
            <p className={styles.hostedPara}>
              The open-source engine supports unlimited leaders and simulations via the API today. The dashboard demo runs two leaders
              side-by-side. The planned hosted product targets organizations that need to run dozens or hundreds of simulations in parallel.
            </p>
            <p className={styles.hostedPara}>
              Defense agencies stress-testing doctrine across leadership profiles. Corporations modeling executive decision-making
              under different market scenarios. Game studios generating divergent NPC civilizations at scale. Government agencies
              simulating policy outcomes before implementation.
            </p>
            <p className={styles.hostedParaLast}>
              Fleet orchestration, distributed parallelization, team workspaces, persistent agent memory, private deployment,
              and enterprise auth are on the roadmap. The open-source engine and Apache-2.0 license are the permanent foundation.
            </p>
            <div className={`responsive-stack ${styles.hostedActions}`}>
              <a href="mailto:team@frame.dev?subject=Paracosm Enterprise Inquiry" className={styles.ctaPrimary}>
                Contact team@frame.dev for roadmap access
              </a>
              <a href="mailto:team@frame.dev?subject=Paracosm Partnership / Investment" className={styles.ctaSecondary}>
                Partnership and investment inquiries
              </a>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className={styles.section} aria-labelledby="pricing-heading">
          <h2 id="pricing-heading" className={styles.h2Tight}>Pricing</h2>
          <p className={styles.pricingNote}>
            Open-core model: the simulation engine is free and open source (Apache-2.0) forever. The paid tiers below are planned hosted
            packaging for infrastructure, persistence, governance, and zero-code workflows. No vendor lock-in.
          </p>
          <div className={`responsive-grid-2 ${styles.grid2}`}>
            {PRICING.map(tier => {
              const status = describeAvailability(tier.availability);
              const tone = AVAILABILITY_TONE_STYLES[status.tone];
              const cardClass = [styles.pricingCard, 'hover-lift', tier.highlight ? styles.highlight : '']
                .filter(Boolean)
                .join(' ');
              return (
                <article key={tier.name} className={cardClass}>
                  <div className={styles.pricingCardHead}>
                    <h3 className={styles.pricingTitle}>{tier.name}</h3>
                    <span className={styles.statusPill} style={pillStyleVars(tone)}>
                      {status.label}
                    </span>
                  </div>
                  <div className={styles.pricingPriceRow}>
                    <span className={styles.pricingPrice}>{tier.price}</span>
                    <span className={styles.pricingPeriod}>{tier.period}</span>
                  </div>
                  <p className={styles.pricingDesc}>{tier.description}</p>
                  <p className={styles.pricingDetail}>{status.detail}</p>
                  <ul className={styles.pricingFeatures}>
                    {tier.features.map(f => (
                      <li key={f} className={styles.pricingFeatureItem}>
                        <span className={styles.checkmark}>&#10003;</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={tier.cta.href}
                    target={tier.cta.href.startsWith('mailto:') ? undefined : '_blank'}
                    rel="noopener"
                    className={styles.pricingCta}
                  >
                    {tier.cta.label}
                  </a>
                </article>
              );
            })}
          </div>
        </section>

        {/* FAQ */}
        <section className={styles.section} aria-labelledby="faq-heading">
          <h2 id="faq-heading" className={styles.h2}>Frequently Asked Questions</h2>
          <div className={styles.faqList}>
            {FAQ.map((item, i) => (
              <details key={i} className={styles.faqItem}>
                <summary className={styles.faqSummary}>{item.q}</summary>
                <div className={styles.faqAnswer}>{item.a}</div>
              </details>
            ))}
          </div>
        </section>

        {/* Tech stack */}
        <section className={styles.section} aria-labelledby="tech-heading">
          <h2 id="tech-heading" className={styles.h2}>Technology</h2>
          <div className={`responsive-grid-3 ${styles.grid3}`}>
            {[
              { label: 'Runtime', value: 'AgentOS (TypeScript)' },
              { label: 'Package', value: 'npm: paracosm' },
              { label: 'License', value: 'Apache-2.0' },
              { label: 'Kernel', value: 'Deterministic (Mulberry32)' },
              { label: 'Personality', value: 'HEXACO six-factor' },
              { label: 'Tool Forging', value: 'Sandboxed V8 + LLM Judge' },
              { label: 'Research', value: 'DOI-linked semantic recall' },
              { label: 'Providers', value: 'OpenAI, Anthropic' },
              { label: 'Dashboard', value: 'React + Vite + Tailwind' },
              { label: 'Scenarios', value: 'Unlimited (JSON + Compiler)' },
              { label: 'Scalability', value: 'Stateless, horizontally scalable' },
              { label: 'Batch Runner', value: 'Multi-scenario experiments' },
            ].map(item => (
              <div key={item.label} className={styles.techItem}>
                <div className={styles.techLabel}>{item.label}</div>
                <div className={styles.techValue}>{item.value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Links */}
        <section className={styles.sectionTight} aria-labelledby="links-heading">
          <h2 id="links-heading" className={styles.h2}>Links</h2>
          <nav aria-label="External links" className={styles.linksNav}>
            <a href="https://agentos.sh/en" target="_blank" rel="noopener" className={styles.linkItem}>agentos.sh</a>
            <a href="https://docs.agentos.sh" target="_blank" rel="noopener" className={styles.linkItem}>Documentation</a>
            <a href="https://github.com/framersai/paracosm" target="_blank" rel="noopener" className={styles.linkItem}>GitHub</a>
            <a href="https://github.com/framersai/agentos" target="_blank" rel="noopener" className={styles.linkItem}>AgentOS GitHub</a>
            <a href="https://www.npmjs.com/package/paracosm" target="_blank" rel="noopener" className={styles.linkItem}>npm</a>
            <a href="https://frame.dev" target="_blank" rel="noopener" className={styles.linkItem}>Frame.dev</a>
            <a href="https://manic.agency" target="_blank" rel="noopener" className={styles.linkItem}>Manic Agency</a>
            <a href="https://wilds.ai/discord" target="_blank" rel="noopener" className={styles.linkItem}>Discord</a>
            <a href="mailto:team@frame.dev" className={styles.linkItem}>team@frame.dev</a>
          </nav>
        </section>
      </div>
    </div>
  );
}
