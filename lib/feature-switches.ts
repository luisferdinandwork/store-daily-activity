// lib/feature-switches.ts
//
// Every on/off switch IT can flip at /it/feature-switches, with its default.
// Client-safe (no DB) — the IT page and the dialogs read the words from here;
// reads/writes live in lib/db/utils/feature-switches.ts. A switch with no
// feature_switches row is at its default.

export interface FeatureSwitchDef {
  title: string;
  /** What turning it on allows, shown on the IT page. */
  description: string;
  /** Where the switch takes effect, e.g. "Ops · Schedules". */
  appliesTo: string;
  defaultEnabled: boolean;
}

export const FEATURE_SWITCHES = {
  schedule_delete_all: {
    title: 'Schedule delete — "Delete everything"',
    description:
      'Lets Ops delete a whole month including its history: attendance, task progress and task photos ' +
      '(typing the store code to confirm). When off, Ops can only use "Keep attendance history", which ' +
      'removes the days without attendance and leaves the rest. Finance money records are kept either way.',
    appliesTo: 'Ops · Schedules',
    defaultEnabled: false,
  },
} as const satisfies Record<string, FeatureSwitchDef>;

export type FeatureSwitchKey = keyof typeof FEATURE_SWITCHES;

export const FEATURE_SWITCH_KEYS = Object.keys(FEATURE_SWITCHES) as FeatureSwitchKey[];

export function isFeatureSwitchKey(value: unknown): value is FeatureSwitchKey {
  return typeof value === 'string' && value in FEATURE_SWITCHES;
}

/** One switch as /api/it/feature-switches returns it. */
export interface FeatureSwitchState {
  key: FeatureSwitchKey;
  title: string;
  description: string;
  appliesTo: string;
  enabled: boolean;
  defaultEnabled: boolean;
  /** Null until IT changes it for the first time. */
  updatedAt: string | null;
  updatedByName: string | null;
}
