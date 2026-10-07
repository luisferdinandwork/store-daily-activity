// scripts/check-mail.ts
//
// Diagnose the Microsoft Graph email setup used by "Lupa password"
// (lib/email/graph-mail.ts). Run it where the failing app runs (the server reads
// its own .env.local):
//
//   npx tsx scripts/check-mail.ts                    # credentials + permissions only — sends nothing
//   npx tsx scripts/check-mail.ts --send you@x.com   # also sends one test email from MAIL_FROM
//
// Prints which permissions the app's token really carries. Never prints the
// secret or the token.

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

import { mailErrorHint, mailFromAddress, sendMail } from '../lib/email/graph-mail';

const args = process.argv.slice(2);
const sendIdx = args.indexOf('--send');
const sendTo = sendIdx >= 0 ? args[sendIdx + 1] : null;

const ok = (msg: string) => console.log(`  ✔ ${msg}`);
const bad = (msg: string) => console.log(`  ✖ ${msg}`);
// A function declaration (not an arrow const) so TypeScript treats calls as
// never-returning and narrows the code after `if (!x.success) fail(...)`.
function fail(msg: string): never {
  console.log(`\n❌ ${msg}\n`);
  process.exit(1);
}

async function main() {
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  const secret = process.env.AZURE_CLIENT_SECRET?.trim();
  const from = mailFromAddress();

  console.log('\nPRISM mail check');
  console.log(`  sender (MAIL_FROM): ${from}`);
  for (const [name, v] of [['AZURE_TENANT_ID', tenantId], ['AZURE_CLIENT_ID', clientId], ['AZURE_CLIENT_SECRET', secret]] as const) {
    if (v) ok(`${name} is set`);
    else bad(`${name} is missing`);
  }
  if (!tenantId || !clientId || !secret) fail('Fill in the missing AZURE_* values in .env.local.');
  if (secret!.length < 30 || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(secret!)) {
    bad('AZURE_CLIENT_SECRET looks like a Secret ID (a GUID) — it must be the secret "Value".');
  }

  // 1. Token
  console.log('\n1. Sign-in to Microsoft (client credentials)');
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId!)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: secret!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!json.access_token) {
    const detail = json.error_description?.split('\n')[0] ?? json.error ?? `HTTP ${res.status}`;
    bad(detail);
    fail(mailErrorHint(detail, from) ?? 'Token request failed.');
  }
  ok('token issued — tenant, client ID and secret are valid');

  // 2. What the token allows
  console.log('\n2. Permissions in the token');
  const claims = JSON.parse(Buffer.from(json.access_token!.split('.')[1], 'base64url').toString()) as {
    app_displayname?: string;
    roles?: string[];
  };
  console.log(`  app: ${claims.app_displayname ?? '?'}`);
  console.log(`  application permissions (roles): ${claims.roles?.length ? claims.roles.join(', ') : '(none)'}`);
  if (!claims.roles?.includes('Mail.Send')) {
    bad('Mail.Send is NOT in the token.');
    fail(
      'In Entra ID → App registrations → this app → API permissions: add Microsoft Graph → ' +
        '"Application permissions" → Mail.Send (a "Delegated" Mail.Send does not work here), then click ' +
        '"Grant admin consent for <tenant>" until the status is a green check. Re-run this check after a few minutes.',
    );
  }
  ok('Mail.Send (Application) is granted and consented');

  // 3. Optional real send
  if (!sendTo) {
    console.log(
      '\n3. Not sending a test email. If the app still gets ErrorAccessDenied with Mail.Send granted, Exchange is\n' +
        `   restricting this app to other mailboxes (RBAC for Applications / Application Access Policy) and ${from}\n` +
        '   is not in its scope — or the change is still propagating (up to ~1 hour). Test for real with:\n' +
        '     npx tsx scripts/check-mail.ts --send <your address>\n',
    );
    return;
  }
  console.log(`\n3. Sending a test email ${from} → ${sendTo}`);
  const result = await sendMail({
    to: sendTo,
    subject: '[PRISM] Tes email',
    html: '<p>Tes pengiriman email PRISM berhasil. Email ini bisa diabaikan.</p>',
    text: 'Tes pengiriman email PRISM berhasil. Email ini bisa diabaikan.',
  });
  if (!result.success) {
    bad(result.error);
    fail('Sending failed — see above.');
  }
  ok(`accepted by Microsoft 365 (mode: ${result.mode}) — check the inbox (and spam) of ${sendTo}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
