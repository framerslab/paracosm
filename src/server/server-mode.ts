export type ParacosmServerMode = 'local_demo' | 'hosted_demo' | 'platform_api';

export function resolveServerMode(env: NodeJS.ProcessEnv): ParacosmServerMode {
  if ((env.PARACOSM_PLATFORM_API || '').toLowerCase() === 'true') return 'platform_api';
  if ((env.PARACOSM_HOSTED_DEMO || '').toLowerCase() === 'true') return 'hosted_demo';
  return 'local_demo';
}
