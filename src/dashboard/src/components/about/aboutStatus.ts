export type ProductAvailability =
  | 'available_now'
  | 'local_build'
  | 'early_access'
  | 'planned'
  | 'design_partners'
  | 'future_roadmap';

export interface AvailabilityDescriptor {
  label: string;
  group: 'available' | 'roadmap';
  tone: 'green' | 'teal' | 'amber' | 'rust';
  detail: string;
}

export function describeAvailability(status: ProductAvailability): AvailabilityDescriptor {
  switch (status) {
    case 'available_now':
      return {
        label: 'Available now',
        group: 'available',
        tone: 'green',
        detail: 'Usable today in the open-source engine and current dashboard.',
      };
    case 'local_build':
      return {
        label: 'Available locally',
        group: 'available',
        tone: 'teal',
        detail: 'Usable today in the CLI and local dashboard; polished hosted self-serve packaging is still planned.',
      };
    case 'early_access':
      return {
        label: 'Early access',
        group: 'available',
        tone: 'amber',
        detail: 'Accessible in limited hosted or demo form, not generally available self-serve SaaS yet.',
      };
    case 'planned':
      return {
        label: 'Planned',
        group: 'roadmap',
        tone: 'amber',
        detail: 'On the near-term roadmap, but not shipping as a generally available product yet.',
      };
    case 'design_partners':
      return {
        label: 'Design partners',
        group: 'roadmap',
        tone: 'amber',
        detail: 'Being shaped with partner teams before broader release.',
      };
    case 'future_roadmap':
      return {
        label: 'Future roadmap',
        group: 'roadmap',
        tone: 'rust',
        detail: 'Directional platform roadmap, not a shipping product yet.',
      };
  }
}
