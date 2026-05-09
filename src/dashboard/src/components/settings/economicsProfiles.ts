export type DashboardEconomicsProfileId =
  | 'economy'
  | 'balanced'
  | 'quality'
  | 'deterministic_first';

export type DashboardServerMode = 'local_demo' | 'hosted_demo' | 'platform_api';

export const ECONOMICS_PROFILE_OPTIONS: Array<{
  value: DashboardEconomicsProfileId;
  label: string;
  description: string;
}> = [
  {
    value: 'economy',
    label: 'Economy',
    description: 'Cheapest path: gated research, cheap verdicts, tighter spend controls.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Current default mix for good quality per dollar on normal runs.',
  },
  {
    value: 'quality',
    label: 'Quality',
    description: 'Push strategic roles and verdict synthesis upward when quality matters more than spend.',
  },
  {
    value: 'deterministic_first',
    label: 'Deterministic First',
    description: 'Skip verdict synthesis and live-search escalation to reduce variance and cost.',
  },
];

export function describeServerMode(mode: DashboardServerMode): { label: string; description: string } {
  switch (mode) {
    case 'hosted_demo':
      return {
        label: 'Hosted demo',
        description: 'Host-billed runs are capped and forced onto the economy guardrails.',
      };
    case 'platform_api':
      return {
        label: 'Platform API',
        description: 'Authenticated `/api/v1/*` routes are enabled; demo-only assumptions are off.',
      };
    case 'local_demo':
    default:
      return {
        label: 'Local demo',
        description: 'Single-process local server. Good for product exploration, not a hosted control plane.',
      };
  }
}
