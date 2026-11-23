export type Look = 'light' | 'dark';

export const LOOK_KEY = 'paracosm-theme';
export const LOOK_GROUND = { light: '#f0e6d2', dark: '#0a0806' } as const;

export function initialLook(stored: string | null, prefersLight: boolean): Look {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersLight ? 'light' : 'dark';
}
