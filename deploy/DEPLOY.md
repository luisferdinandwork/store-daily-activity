# Self-hosting on the Ubuntu server (PM2 + nginx)

Target: Ubuntu server (same box that runs PostgreSQL, `103.94.239.190`).
App: Next.js 16 on `127.0.0.1:3000`, nginx terminates the public :80/:443.
PM2 process name: `store-daily-task`. Deploy path: `/var/www/store-daily-task`.

---

## 1. Prerequisites (once per server)

```bash
# Node 22 (matches the dev machine) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential git

# PM2 (global) + nginx
sudo npm install -g pm2
sudo apt install -y nginx

node -v && pm2 -v && nginx -v
```

## 2. Get the code

```bash
sudo mkdir -p /var/www && sudo chown "$USER" /var/www
cd /var/www
git clone <your-repo-url> store-daily-task
cd store-daily-task
```

If there is no git remote, copy the folder up with `rsync -av --exclude node_modules --exclude .next ./ user@103.94.239.190:/var/www/store-daily-task/`.

## 3. Environment

Create `/var/www/store-daily-task/.env.local` (Next.js loads it at build and
runtime). Start from the dev machine's `.env.local`, then change:

```ini
DATABASE_URL="postgresql://dts_user:Prestasi10@127.0.0.1:5432/daily-task-store"
NEXTAUTH_URL="https://your-domain.com"      # real public URL — not localhost
NEXTAUTH_SECRET="<keep or rotate>"
CRON_SECRET="<pick a long random string>"   # must match deploy/crontab.example
# BC_*, OSS_* — copy as-is
```

## 4. Build

```bash
cd /var/www/store-daily-task
npm ci
npm run db:migrate        # apply any pending migrations
npm run build
```

## 5. Start under PM2

```bash
pm2 start ecosystem.config.js
pm2 save                              # snapshot current process list
pm2 startup                           # prints a sudo command — run it once
```

`ecosystem.config.js` runs `next start -p 3000` from the repo root.

Redeploys after this:

```bash
cd /var/www/store-daily-task
git pull
npm ci
npm run db:migrate
npm run build
pm2 reload ecosystem.config.js        # zero-downtime
```

## 6. nginx

```bash
sudo cp deploy/nginx/store-daily-task.conf \
        /etc/nginx/sites-available/store-daily-task
sudo ln -s /etc/nginx/sites-available/store-daily-task \
           /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
# edit server_name in the file first
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow 'Nginx Full'
```

Visit `http://your-domain.com` (or `http://103.94.239.190`) — you should get the app.

## 7. HTTPS (recommended)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

certbot edits the nginx file to add the 443 block + HTTP→HTTPS redirect and sets
up auto-renewal. Make sure `NEXTAUTH_URL` uses `https://` afterwards, then
`pm2 reload ecosystem.config.js`.

## 8. Scheduled jobs (replaces vercel.json crons)

Vercel is no longer hitting the `/api/cron/*` endpoints. Recreate them with the
system crontab — see `deploy/crontab.example`:

```bash
crontab -e   # paste the lines, set CRON_SECRET to match .env.local
```

---

## Quick reference

| Task                | Command                                        |
|---------------------|------------------------------------------------|
| Status              | `pm2 status`                                   |
| Logs                | `pm2 logs store-daily-task`                    |
| Restart             | `pm2 reload ecosystem.config.js`               |
| Stop                | `pm2 stop store-daily-task`                    |
| nginx test + reload | `sudo nginx -t && sudo systemctl reload nginx` |
| nginx error log     | `sudo tail -f /var/log/nginx/error.log`        |
