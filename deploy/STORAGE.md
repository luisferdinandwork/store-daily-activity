# Image / file storage — Biznet NOS (S3-compatible)

All uploaded images (task photos, petty-cash receipts, issue evidence, manuals)
are stored in **Biznet NOS** (Neo Object Storage), an S3-compatible service.

| | |
|---|---|
| Bucket | `prism` |
| Prefix (folder) | `storedailytask/` |
| Primary endpoint | `https://nos.wjv-1.neo.id` (Jawa Barat / WJV) |
| Secondary endpoint | `https://nos.jkt-1.neo.id` (Jakarta / JKT) |
| Access key | `00a74f6e7800cc3fa66f` |
| Secret key | in `.env.local` as `NOS_SECRET_ACCESS_KEY` (not committed) |
| Public URL shape | `https://nos.wjv-1.neo.id/prism/storedailytask/<path>` |

The code lives in [`lib/storage.ts`](../lib/storage.ts).

## How multi-region / failover works

NOS replicates the bucket between the two regions, so **both endpoints serve the
same bucket and the same objects**. The app treats them as a hot/hot pair:

1. Every request (upload, existence check, delete) is sent to the
   **last endpoint that worked** (starts at the primary).
2. If that call fails with a network error or a 5xx/429, it is **automatically
   retried against the other endpoint**.
3. Whichever endpoint answers becomes the preferred one for subsequent calls.
4. A 4xx (e.g. 403 bad credentials, 404 not found) is **not** retried — the
   result is the same on both endpoints.

Nothing to configure at runtime; it is automatic. You can change or reorder the
endpoints with `NOS_ENDPOINT_PRIMARY` / `NOS_ENDPOINT_SECONDARY` in `.env.local`.

## Environment variables

```ini
NOS_ACCESS_KEY_ID=00a74f6e7800cc3fa66f
NOS_SECRET_ACCESS_KEY=...            # from the NOS console — REQUIRED
NOS_BUCKET=prism
NOS_ENDPOINT_PRIMARY=https://nos.wjv-1.neo.id
NOS_ENDPOINT_SECONDARY=https://nos.jkt-1.neo.id
NOS_FOLDER=storedailytask
# NOS_REGION=id-jkt-1                # optional, NOS ignores it
# NOS_PUBLIC_BASE_URL=https://cdn…   # optional, only if a CDN fronts the bucket
```

---

## Browsing the bucket ("checking the folder")

The S3 endpoint is an **API**, not a website — opening `https://nos.wjv-1.neo.id`
in a browser does nothing useful. Use an S3 client. Pick one:

### Option A — AWS CLI (quickest for scripting)

Install: <https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html>

One-time credential setup (creates a named profile called `nos`):

```bash
aws configure set aws_access_key_id 00a74f6e7800cc3fa66f --profile nos
aws configure set aws_secret_access_key <YOUR_SECRET_KEY> --profile nos
aws configure set region id-jkt-1 --profile nos
```

Then, always passing `--endpoint-url`:

```bash
# list the top level of the bucket
aws s3 ls s3://prism/ --endpoint-url https://nos.wjv-1.neo.id --profile nos

# list our app's folder (note the trailing slash)
aws s3 ls s3://prism/storedailytask/ --recursive --endpoint-url https://nos.wjv-1.neo.id --profile nos

# download one object
aws s3 cp s3://prism/storedailytask/tasks/opening/foo.jpg ./foo.jpg --endpoint-url https://nos.wjv-1.neo.id --profile nos

# upload / delete
aws s3 cp ./bar.jpg s3://prism/storedailytask/bar.jpg --endpoint-url https://nos.wjv-1.neo.id --profile nos
aws s3 rm s3://prism/storedailytask/bar.jpg --endpoint-url https://nos.wjv-1.neo.id --profile nos
```

Swap the endpoint for `https://nos.jkt-1.neo.id` any time — you should see the
exact same listing. That is how you verify replication is healthy.

Tip: make an alias so you don't retype the flags:

```bash
alias noswjv='aws --endpoint-url https://nos.wjv-1.neo.id --profile nos'
alias nosjkt='aws --endpoint-url https://nos.jkt-1.neo.id --profile nos'
noswjv s3 ls s3://prism/storedailytask/
```

### Option B — rclone (best for browsing + syncing)

Install: <https://rclone.org/install/>. Add to `~/.config/rclone/rclone.conf`
(or `%APPDATA%\rclone\rclone.conf` on Windows):

```ini
[nos-wjv]
type = s3
provider = Other
access_key_id = 00a74f6e7800cc3fa66f
secret_access_key = <YOUR_SECRET_KEY>
endpoint = https://nos.wjv-1.neo.id
acl = public-read

[nos-jkt]
type = s3
provider = Other
access_key_id = 00a74f6e7800cc3fa66f
secret_access_key = <YOUR_SECRET_KEY>
endpoint = https://nos.jkt-1.neo.id
acl = public-read
```

```bash
rclone tree nos-wjv:prism/storedailytask
rclone ls   nos-wjv:prism/storedailytask
rclone copy nos-wjv:prism/storedailytask ./backup     # pull a backup
rclone check nos-wjv:prism nos-jkt:prism               # compare the two regions
rclone serve http nos-wjv:prism                        # browse in a web UI at localhost:8080
```

### Option C — Desktop GUI (click around, no terminal)

Any of these; all ask for the same 4 things — Access key, Secret key, Endpoint,
and "path style / force path-style = ON":

- **Cyberduck** (Win/Mac, free) — New Connection → "Amazon S3" → in *Server* put
  `nos.wjv-1.neo.id`, port 443, your keys. Then *Path* = `/prism`.
- **WinSCP** (Windows, free) — New Site → File protocol "Amazon S3" → Host name
  `nos.wjv-1.neo.id`, your keys.
- **S3 Browser** (Windows, free tier) — Accounts → Add → "S3 Compatible Storage"
  → REST endpoint `nos.wjv-1.neo.id`.

Set up two connections, one per endpoint, so you can eyeball both regions.

### Option D — s3cmd

```bash
s3cmd --access_key=00a74f6e7800cc3fa66f --secret_key=<YOUR_SECRET_KEY> \
      --host=nos.wjv-1.neo.id --host-bucket='%(bucket)s.nos.wjv-1.neo.id' \
      ls s3://prism/storedailytask/
```

---

## Making objects publicly readable

Task photos are shown in the app with a plain `<img src="…">`, so the objects
must be world-readable. The app already sends `ACL: public-read` on every
upload. If images still 403 in the browser, the **bucket policy** is blocking
anonymous reads — fix it once from the NOS console, or with the CLI:

```bash
cat > /tmp/policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadForApp",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::prism/storedailytask/*"
  }]
}
EOF

aws s3api put-bucket-policy --bucket prism --policy file:///tmp/policy.json \
    --endpoint-url https://nos.wjv-1.neo.id --profile nos
```

Verify: `curl -I https://nos.wjv-1.neo.id/prism/storedailytask/<some-key>` should
return `200`, not `403`.

---

## Legacy Alibaba Cloud OSS

Images uploaded **before** this switch still live in the old Alibaba OSS bucket
(`pntpri-app`). They keep displaying (their full URL is stored in the DB) and
the 60-day retention cron still deletes them via `lib/oss.ts`. Once the backlog
has aged out, delete `lib/oss.ts`, the `OSS_*` env vars, and the `ali-oss`
dependency.
