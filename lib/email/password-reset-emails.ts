// lib/email/password-reset-emails.ts
//
// The "Lupa password" emails (Indonesian). Each returns { subject, html, text }
// for sendMail(). Table layout + inline styles so Outlook / Gmail render them.
// The link email shows a masked NIK only — see maskNik() in lib/password-reset.ts.

import { maskNik, RESET_LINK_TTL_HOURS, RESET_MAX_NIK_ATTEMPTS } from '@/lib/password-reset';

const BRAND = '#7A5AF8';
const APP_NAME = 'PRISM';

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatWib(date: Date): string {
  return `${date.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })} WIB`;
}

type Row = [label: string, value: string];

function detailRows(rows: Row[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;">
${rows
  .map(
    ([label, value], i) => `<tr>
  <td style="padding:10px 14px;font-size:12px;color:#64748b;width:38%;${i ? 'border-top:1px solid #e2e8f0;' : ''}">${esc(label)}</td>
  <td style="padding:10px 14px;font-size:13px;color:#0f172a;font-weight:600;${i ? 'border-top:1px solid #e2e8f0;' : ''}">${esc(value)}</td>
</tr>`,
  )
  .join('\n')}
</table>`;
}

function layout(opts: { heading: string; bodyHtml: string; footnote?: string }): string {
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="background:${BRAND};padding:18px 24px;">
      <span style="font-size:15px;font-weight:800;letter-spacing:.08em;color:#ffffff;">${APP_NAME}</span>
      <span style="font-size:12px;color:#e9e3fe;"> &nbsp;·&nbsp; Prestasi Retail Integrated Store Management</span>
    </td></tr>
    <tr><td style="padding:24px;">
      <h1 style="margin:0 0 12px;font-size:19px;line-height:1.3;color:#0f172a;">${esc(opts.heading)}</h1>
      ${opts.bodyHtml}
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;line-height:1.5;color:#94a3b8;">
      ${opts.footnote ? `${esc(opts.footnote)}<br>` : ''}Email ini dikirim otomatis — mohon tidak membalas email ini.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

const p = (html: string) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">${html}</p>`;

export interface ResetEmailPerson {
  name: string;
  nik: string;
  storeLabel: string;
}

// ─── 1. Request received (to the store mailbox) ───────────────────────────────

export function requestReceivedEmail(person: ResetEmailPerson, at: Date): Rendered {
  const nik = maskNik(person.nik);
  return {
    subject: `[${APP_NAME}] Permintaan reset password diterima — ${person.name}`,
    html: layout({
      heading: 'Permintaan reset password diterima',
      bodyHtml: [
        p(`Kami menerima permintaan untuk membuat password baru untuk akun berikut:`),
        detailRows([
          ['Nama', person.name],
          ['NIK', nik],
          ['Toko', person.storeLabel],
          ['Waktu', formatWib(at)],
        ]),
        p(`Tim IT akan memverifikasi permintaan ini. Setelah disetujui, link untuk membuat password baru akan dikirim ke email toko ini.`),
        p(`<strong>Bukan Anda yang meminta?</strong> Abaikan email ini dan beri tahu tim IT. Password lama tetap berlaku.`),
      ].join('\n'),
    }),
    text: [
      'Permintaan reset password diterima.',
      `Nama: ${person.name}`,
      `NIK: ${nik}`,
      `Toko: ${person.storeLabel}`,
      `Waktu: ${formatWib(at)}`,
      '',
      'Tim IT akan memverifikasi permintaan ini, lalu mengirim link untuk membuat password baru ke email toko ini.',
      'Bukan Anda yang meminta? Abaikan email ini dan beri tahu tim IT.',
    ].join('\n'),
  };
}

// ─── 2. The link (to the store mailbox, after IT verified) ────────────────────

export function resetLinkEmail(person: ResetEmailPerson, link: string, expiresAt: Date): Rendered {
  const nik = maskNik(person.nik);
  return {
    subject: `[${APP_NAME}] Link buat password baru — ${person.name}`,
    html: layout({
      heading: 'Buat password baru',
      bodyHtml: [
        p(`Permintaan reset password untuk <strong>${esc(person.name)}</strong> (NIK ${esc(nik)}) sudah diverifikasi IT.`),
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="border-radius:10px;background:${BRAND};">
  <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Buat password baru</a>
</td></tr></table>`,
        detailRows([
          ['Untuk', `${person.name} · NIK ${nik}`],
          ['Toko', person.storeLabel],
          ['Berlaku sampai', formatWib(expiresAt)],
        ]),
        p(`Link ini <strong>hanya bisa dipakai oleh NIK di atas</strong> dan hanya sekali. Di halaman tersebut Anda akan diminta mengisi NIK, password baru, dan konfirmasi password.`),
        p(`Jika tombol tidak bisa diklik, salin alamat ini ke browser:<br><span style="word-break:break-all;font-size:12px;color:${BRAND};">${esc(link)}</span>`),
      ].join('\n'),
      footnote: `Link berlaku ${RESET_LINK_TTL_HOURS} jam. Setelah ${RESET_MAX_NIK_ATTEMPTS}× NIK salah, link otomatis dinonaktifkan.`,
    }),
    text: [
      `Permintaan reset password untuk ${person.name} (NIK ${nik}) sudah diverifikasi IT.`,
      '',
      `Buat password baru: ${link}`,
      '',
      `Berlaku sampai ${formatWib(expiresAt)}. Link hanya bisa dipakai oleh NIK tersebut, sekali saja.`,
    ].join('\n'),
  };
}

// ─── 3. Done (to the store mailbox) ───────────────────────────────────────────

export function resetCompletedEmail(person: ResetEmailPerson, at: Date): Rendered {
  const nik = maskNik(person.nik);
  return {
    subject: `[${APP_NAME}] Password berhasil diubah — ${person.name}`,
    html: layout({
      heading: 'Password berhasil diubah',
      bodyHtml: [
        p(`Password akun berikut baru saja diganti melalui link reset password:`),
        detailRows([
          ['Nama', person.name],
          ['NIK', nik],
          ['Toko', person.storeLabel],
          ['Waktu', formatWib(at)],
        ]),
        p(`Silakan masuk ke ${APP_NAME} dengan password baru.`),
        p(`<strong>Bukan Anda yang mengganti?</strong> Segera hubungi tim IT.`),
      ].join('\n'),
    }),
    text: [
      `Password untuk ${person.name} (NIK ${nik}) berhasil diubah pada ${formatWib(at)}.`,
      'Bukan Anda yang mengganti? Segera hubungi tim IT.',
    ].join('\n'),
  };
}

// ─── 4. Rejected (to the store mailbox) ───────────────────────────────────────

export function requestRejectedEmail(person: ResetEmailPerson, reason: string | null): Rendered {
  const nik = maskNik(person.nik);
  return {
    subject: `[${APP_NAME}] Permintaan reset password tidak diproses — ${person.name}`,
    html: layout({
      heading: 'Permintaan reset password tidak diproses',
      bodyHtml: [
        p(`Permintaan reset password untuk <strong>${esc(person.name)}</strong> (NIK ${esc(nik)}) tidak diproses oleh tim IT.`),
        reason ? detailRows([['Alasan', reason]]) : '',
        p(`Password lama tetap berlaku. Jika masih membutuhkan bantuan, hubungi tim IT.`),
      ].join('\n'),
    }),
    text: [
      `Permintaan reset password untuk ${person.name} (NIK ${nik}) tidak diproses oleh tim IT.`,
      reason ? `Alasan: ${reason}` : '',
      'Password lama tetap berlaku.',
    ].filter(Boolean).join('\n'),
  };
}

// ─── IT copy (optional — MAIL_IT_NOTIFY_TO) ───────────────────────────────────

export function itNotifyEmail(
  kind: 'requested' | 'completed',
  person: ResetEmailPerson & { email: string },
  at: Date,
  itPageUrl: string,
): Rendered {
  const heading = kind === 'requested' ? 'Permintaan reset password baru' : 'Reset password berhasil';
  return {
    subject: `[${APP_NAME} IT] ${heading} — ${person.name} (${person.nik})`,
    html: layout({
      heading,
      bodyHtml: [
        detailRows([
          ['Nama', person.name],
          ['NIK', person.nik],
          ['Toko', person.storeLabel],
          ['Email toko', person.email],
          ['Waktu', formatWib(at)],
        ]),
        p(
          kind === 'requested'
            ? `Verifikasi dan kirim link di <a href="${esc(itPageUrl)}" style="color:${BRAND};">halaman Reset Password IT</a>.`
            : `Detail ada di <a href="${esc(itPageUrl)}" style="color:${BRAND};">halaman Reset Password IT</a>.`,
        ),
      ].join('\n'),
    }),
    text: [heading, `${person.name} (${person.nik}) — ${person.storeLabel}`, formatWib(at), itPageUrl].join('\n'),
  };
}
