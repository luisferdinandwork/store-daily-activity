// scripts/seed/index.ts
//
// Single entry point for all seed data — replaces the old chain of separate
// `npm run seed:*` commands. Each step used to be its own `tsx` process, so
// running "all" meant paying Node startup + TypeScript transpile + dotenv
// load 8 separate times; here every step runs as a plain function call in
// one process, back to back, which is what actually makes "seed everything"
// fast — the steps themselves still do the same DB work as before.
//
// Usage:
//   npm run db:seed                          # run every step, in order
//   npm run db:seed -- --only=setup,tasks     # run a subset, still in order
//   npm run db:seed -- --list                 # print step names and exit
//
// Order matters — later steps read data created by earlier ones (schedules
// need stores/users from setup, attendance needs schedules, etc.), so
// --only just filters the fixed pipeline below rather than reordering it.

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { seedSetup } from './setup';
import { seedBusinessCentralSettings } from './business-central-settings';
import { seedPerformanceTargets } from './performance-targets';
import { seedShiftTasks } from './shift-tasks';
import { seedSchedules } from './schedules';
import { seedTasks } from './tasks';
import { seedAttendance } from './attendance';
import { seedPettyCash } from './petty-cash';

type SeedStep = { name: string; run: () => Promise<void> };

// The default pipeline seeds the FF001 world exactly as it stands in
// "Break down target sep 2026.xlsx": area + store + roster, the Sep 2026
// performance target, and the Sep 2026 schedule (working days + OFF + AL).
//
// `tasks` and `attendance` are intentionally left OUT of the default run:
// they synthesise randomised task-completion and check-in/out activity on top
// of the schedule, which isn't part of the sheet. Re-enable them explicitly
// when you want a fuller demo world:
//   npm run db:seed -- --only=tasks,attendance
const STEPS: SeedStep[] = [
  { name: 'setup', run: seedSetup },
  { name: 'bc-settings', run: seedBusinessCentralSettings },
  { name: 'performance-targets', run: seedPerformanceTargets },
  { name: 'shift-tasks', run: seedShiftTasks },
  { name: 'schedules', run: seedSchedules },
  { name: 'petty-cash', run: seedPettyCash },
];

// Available via `--only=` but not part of the default pipeline (see note above).
const OPTIONAL_STEPS: SeedStep[] = [
  { name: 'tasks', run: seedTasks },
  { name: 'attendance', run: seedAttendance },
];

const ALL_STEPS: SeedStep[] = [...STEPS, ...OPTIONAL_STEPS];

function parseOnly(argv: string[]): Set<string> | null {
  const flag = argv.find((a) => a.startsWith('--only='));
  if (!flag) return null;
  return new Set(flag.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean));
}

function fmtSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function run() {
  const argv = process.argv.slice(2);

  if (argv.includes('--list')) {
    console.log(STEPS.map((s) => s.name).join('\n'));
    console.log(`\n# optional (only via --only=):\n${OPTIONAL_STEPS.map((s) => s.name).join('\n')}`);
    return;
  }

  const only = parseOnly(argv);
  // --only can pick from every step, including the optional ones; a bare run
  // only executes the default pipeline.
  const steps = only ? ALL_STEPS.filter((s) => only.has(s.name)) : STEPS;

  if (only) {
    const unknown = [...only].filter((name) => !ALL_STEPS.some((s) => s.name === name));
    if (unknown.length) {
      throw new Error(
        `Unknown seed step(s): ${unknown.join(', ')}. Available: ${ALL_STEPS.map((s) => s.name).join(', ')}`,
      );
    }
  }

  if (steps.length === 0) {
    console.log('Nothing to run.');
    return;
  }

  console.log(`🌱 Seeding ${steps.length} step(s): ${steps.map((s) => s.name).join(' → ')}\n`);

  const overallStart = Date.now();

  for (const step of steps) {
    const stepStart = Date.now();
    console.log(`\n▶ ${step.name}`);
    await step.run();
    console.log(`✓ ${step.name} done in ${fmtSeconds(Date.now() - stepStart)}`);
  }

  console.log(`\n✅ All done in ${fmtSeconds(Date.now() - overallStart)}.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Seeding failed:', err);
    process.exit(1);
  });
