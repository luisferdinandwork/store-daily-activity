// PM2 process definition for the production server.
//
//   pm2 start ecosystem.config.js        # first launch
//   pm2 reload ecosystem.config.js       # zero-downtime redeploy
//   pm2 logs store-daily-task            # tail logs
//   pm2 save                             # persist across reboots (after pm2 startup)
//
// Runtime env (DATABASE_URL, NEXTAUTH_*, BC_*, NOS_*, OSS_*, CRON_SECRET) is read from
// `.env.local` / `.env.production` in `cwd` — Next.js loads those automatically.
// Keep secrets in that file, not here.

module.exports = {
  apps: [
    {
      name: 'store-daily-task',
      // Call Next's binary directly — more reliable under PM2 than an npm script.
      script: 'node_modules/next/dist/bin/next',
      // Bind to loopback only: nginx (127.0.0.1:3000 upstream) is the sole entry point, so
      // nobody can reach the app directly on :3000 and spoof X-Real-IP / X-Forwarded-*, which
      // the login throttle (lib/auth/rate-limit.ts) and proxy.ts rely on.
      args: 'start -p 3000 -H 127.0.0.1',
      cwd: '/home/itdevs/daily-task-store',

      // Next's own server is single-process; run one instance in fork mode.
      // To use more cores, switch to: exec_mode: 'cluster', instances: 'max'
      exec_mode: 'fork',
      instances: 1,

      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      max_memory_restart: '1G',

      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // Logs -> pm2 logs / ~/.pm2/logs
      time: true,
      merge_logs: true,
    },
  ],
};
