This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Database (self-hosted PostgreSQL)

The app talks to a plain PostgreSQL server via `pg` (node-postgres) — see
`lib/db/index.ts`. Connection is read from `DATABASE_URL` in `.env.local`:

```
DATABASE_URL="postgresql://dts_user:PASSWORD@SERVER_HOST:5432/daily-task-store"
```

Use `127.0.0.1` as the host on the server itself; use the server's LAN/public
IP from a dev machine (the server must allow remote connections — see below).

Schema / data commands:

```bash
npm run db:generate   # generate a migration from lib/db/schema changes
npm run db:migrate    # apply pending migrations (drizzle-kit migrate)
npm run db:reset      # drop every table + enum + migration record in `public`
npm run db:seed       # populate demo data (npm run db:seed -- --list to see steps)
npm run db:studio     # drizzle-kit studio
```

Fresh server bootstrap: `npm run db:migrate && npm run db:seed`.
Rebuild from scratch: `npm run db:reset && npm run db:migrate && npm run db:seed`.

### One-time PostgreSQL setup on Ubuntu 22.04

```bash
# 1. Install
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

# 2. Create role + database (db name has a hyphen, so it must be quoted)
sudo -u postgres psql <<'SQL'
CREATE ROLE dts_user WITH LOGIN PASSWORD 'Prestasi10';
CREATE DATABASE "daily-task-store" OWNER dts_user;
GRANT ALL PRIVILEGES ON DATABASE "daily-task-store" TO dts_user;
SQL

# 3. Allow remote connections (skip if the app runs on the same box)
#    Find config dir: sudo -u postgres psql -c 'SHOW config_file;'
PGVER=$(psql --version | grep -oP '\d+' | head -1)
sudo sed -i "s/^#listen_addresses.*/listen_addresses = '*'/" /etc/postgresql/$PGVER/main/postgresql.conf
echo "host  daily-task-store  dts_user  0.0.0.0/0  scram-sha-256" | sudo tee -a /etc/postgresql/$PGVER/main/pg_hba.conf
sudo systemctl restart postgresql

# 4. Open the firewall (restrict the CIDR to your office/VPN range if you can)
sudo ufw allow 5432/tcp

# 5. Verify from the dev machine
#    psql "postgresql://dts_user:Prestasi10@SERVER_HOST:5432/daily-task-store" -c '\conninfo'
```

For production, prefer restricting `pg_hba.conf` and `ufw` to a specific IP
range and putting the DB behind a VPN rather than exposing 5432 to the world.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
