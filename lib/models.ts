export const MODEL_VERSIONS = {
  statistical: 'STAT-7.0-WF',
  ai: 'AI-7.0-LOGREG',
  hybrid: 'HYBRID-7.0-45_55',
  random: 'RANDOM-7.0-SEEDED',
} as const;

export type ModelMode = keyof typeof MODEL_VERSIONS;
