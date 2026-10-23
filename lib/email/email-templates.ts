// lib/email/email-templates.ts
// ─────────────────────────────────────────────────────────────────────────────
// Editable emails. IT edits each one at /it/email-templates in one of two ways:
//   • Body — a heading, a message and a few switches; the clean PRISM layout
//     around them is fixed (buildEmailHtml);
//   • HTML — the whole email as raw HTML.
// Either way an email is stored (and sent) as subject + HTML; the text between
// {{double braces}} is replaced when it goes out. No email_templates row = the
// built-in default below.
//
// Two kinds of placeholder:
//   • text ones ({{title}}, {{store}}, …) are HTML-escaped inside the HTML;
//   • html ones ({{detailsTable}}, {{openLink}}) are ready-made pieces of
//     markup, inserted as they are (and left empty in the subject).
//
// Pure — no DB. Stored templates are read in lib/db/utils/email-templates.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { APP_NAME, BRAND, esc } from '@/lib/email/password-reset-emails';

export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_HTML_MAX = 100_000;
export const EMAIL_FIELD_MAX = { heading: 200, message: 2000, footnote: 300 } as const;

export type EmailTemplateMode = 'body' | 'html';

/** What "Body" mode edits; the layout around it is fixed. */
export interface EmailBodyFields {
  /** Big headline. */
  heading: string;
  /** Plain text; a blank line starts a new paragraph. */
  message: string;
  /** Show the {{detailsTable}} (store, area, time) under the message. */
  showDetails: boolean;
  /** Show the {{openLink}} button under that. */
  showOpenLink: boolean;
  /** Small grey line above the standard "sent automatically" note. */
  footnote: string;
}

export interface EmailPlaceholder {
  name: string;
  description: string;
  /** true = markup inserted as it is; false = plain text, HTML-escaped. */
  html: boolean;
  /** Shown in the IT preview. */
  sample: string;
}

export interface EmailTemplateDef {
  title: string;
  /** When this email is sent, shown on the IT page. */
  description: string;
  placeholders: EmailPlaceholder[];
  defaultSubject: string;
  defaultFields: EmailBodyFields;
  /** buildEmailHtml(defaultFields) */
  defaultHtml: string;
}

// ─── Clean layout + building blocks ──────────────────────────────────────────

const INK = '#111827';
const TEXT = '#374151';
const MUTED = '#6b7280';
const LINE = '#eef0f3';

/** The PRISM email: small wordmark, one white card, quiet footer. Inline styles + tables for Outlook. */
export function cleanEmailShell(opts: { heading: string; bodyHtml: string; footnote?: string }): string {
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 14px;font-size:13px;font-weight:800;letter-spacing:.14em;color:${BRAND};">${APP_NAME}</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px 32px 28px;">
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;font-weight:700;color:${INK};">${esc(opts.heading)}</h1>
      ${opts.bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:#9ca3af;">
      ${opts.footnote ? `${esc(opts.footnote)}<br>` : ''}Email ini dikirim otomatis — mohon tidak membalas email ini.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** Plain text → paragraphs (blank line = new paragraph, single newline = line break). Escaped; {{placeholders}} survive. */
export function messageHtml(message: string): string {
  return message
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map(
      (para) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${TEXT};">${esc(para).replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n');
}

/** Label / value list with hairlines — no boxes. Rows are [label, value]. */
export function cleanDetailRows(rows: readonly (readonly [string, string])[]): string {
  const cell = `padding:11px 0;border-bottom:1px solid ${LINE};`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:1px solid ${LINE};">
${rows
  .map(
    ([label, value]) => `<tr>
  <td style="${cell}font-size:13px;color:${MUTED};width:30%;vertical-align:top;">${esc(label)}</td>
  <td style="${cell}font-size:14px;color:${INK};font-weight:600;">${esc(value)}</td>
</tr>`,
  )
  .join('\n')}
</table>`;
}

/** A solid call-to-action button. */
export function buttonLink(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;"><tr><td style="background:${BRAND};border-radius:8px;"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
}

/** The HTML that Body mode stands for. */
export function buildEmailHtml(fields: EmailBodyFields): string {
  return cleanEmailShell({
    heading: fields.heading,
    bodyHtml: [
      messageHtml(fields.message),
      fields.showDetails ? '{{detailsTable}}' : '',
      fields.showOpenLink ? '{{openLink}}' : '',
    ]
      .filter(Boolean)
      .join('\n'),
    footnote: fields.footnote.trim() || undefined,
  });
}

// ─── Templates ───────────────────────────────────────────────────────────────

const ISSUE_DEFAULT_FIELDS: EmailBodyFields = {
  heading: '{{title}}',
  message: '{{body}}',
  showDetails: true,
  showOpenLink: true,
  footnote: 'Anda menerima email ini karena issue ini diteruskan ke tim Anda.',
};

export const EMAIL_TEMPLATES = {
  issue_notification: {
    title: 'Issue notification',
    description:
      'Sent to the people an issue is routed to (Ops of the store\'s area, Ops HO, Finance, IT, Audit) who have an ' +
      'email set, on every issue event: reported, in review, completed, …',
    placeholders: [
      { name: 'title', description: 'Headline of the event, e.g. "New issue: Printer rusak"', html: false, sample: 'New issue: Printer kasir rusak' },
      { name: 'body', description: 'Short sentence about the event', html: false, sample: 'An issue was reported and routed to your team.' },
      { name: 'store', description: 'Store code · name (empty when unknown)', html: false, sample: 'FF001 · Fisik Football - Daan Mogot' },
      { name: 'area', description: 'Area of the store (empty when unknown)', html: false, sample: 'DKI - BALI' },
      { name: 'time', description: 'When it happened, WIB', html: false, sample: '23 Oktober 2026 pukul 08.41 WIB' },
      { name: 'link', description: 'Web address of the Issues page (empty when the server URL is not set)', html: false, sample: 'https://prism.example.com/ops/issues' },
      { name: 'appName', description: 'The app name', html: false, sample: APP_NAME },
      { name: 'detailsTable', description: 'Ready-made list with store, area and time (rows without a value are left out)', html: true, sample: '' },
      { name: 'openLink', description: 'Ready-made "Buka halaman Issues" button (empty without a link)', html: true, sample: '' },
    ],
    defaultSubject: `[{{appName}}] {{title}}`,
    defaultFields: ISSUE_DEFAULT_FIELDS,
    defaultHtml: buildEmailHtml(ISSUE_DEFAULT_FIELDS),
  },
} satisfies Record<string, EmailTemplateDef>;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;

export const EMAIL_TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[];

export function isEmailTemplateKey(value: unknown): value is EmailTemplateKey {
  return typeof value === 'string' && value in EMAIL_TEMPLATES;
}

/** Rows of the preview's {{detailsTable}}. */
export const DETAILS_SAMPLE_ROWS = [
  ['Toko', 'FF001 · Fisik Football - Daan Mogot'],
  ['Area', 'DKI - BALI'],
  ['Waktu', '23 Oktober 2026 pukul 08.41 WIB'],
] as const;

// ─── Rendering ───────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Every `{{name}}` used in a piece of template text. */
export function usedPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];
}

/** Rendered subject + html + plain text of a template with `vars` filled in. */
export function renderEmailTemplate(
  key: EmailTemplateKey,
  template: { subject: string; html: string },
  vars: Record<string, string>,
): { subject: string; html: string; text: string } {
  const defs = new Map<string, EmailPlaceholder>(EMAIL_TEMPLATES[key].placeholders.map((ph) => [ph.name, ph]));

  const fill = (source: string, target: 'subject' | 'html') =>
    source.replace(PLACEHOLDER_RE, (whole, name: string) => {
      const def = defs.get(name);
      if (!def) return whole;
      const value = vars[name] ?? '';
      if (target === 'subject') return def.html ? '' : value.replace(/\s+/g, ' ');
      return def.html ? value : escHtml(value);
    });

  const html = fill(template.html, 'html');
  return {
    subject: fill(template.subject, 'subject').trim() || `[${APP_NAME}]`,
    html,
    text: htmlToText(html),
  };
}

/** Plain-text twin of an HTML email (for the dev console and as a fallback). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|tr|table|div|li)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Validation (what IT may save) ───────────────────────────────────────────

/** What the editor sends / what is stored. */
export interface EmailTemplateValue {
  subject: string;
  mode: EmailTemplateMode;
  html: string;
  fields: EmailBodyFields;
}

/** Body fields from untrusted input; anything missing or malformed falls back to `fallback`. */
export function parseBodyFields(raw: unknown, fallback: EmailBodyFields): EmailBodyFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, def: string) => (typeof v === 'string' ? v : def);
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  return {
    heading: str(r.heading, fallback.heading),
    message: str(r.message, fallback.message),
    showDetails: bool(r.showDetails, fallback.showDetails),
    showOpenLink: bool(r.showOpenLink, fallback.showOpenLink),
    footnote: str(r.footnote, fallback.footnote),
  };
}

export function resolveEmailTemplate(
  key: EmailTemplateKey,
  input: { subject: unknown; mode: unknown; html: unknown; fields: unknown },
): { ok: true; value: EmailTemplateValue } | { ok: false; error: string } {
  const def = EMAIL_TEMPLATES[key];
  const mode: EmailTemplateMode = input.mode === 'body' ? 'body' : 'html';
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const fields = parseBodyFields(input.fields, def.defaultFields);

  if (!subject) return { ok: false, error: 'Subject is required.' };
  if (subject.length > EMAIL_SUBJECT_MAX) return { ok: false, error: `Subject is too long (max ${EMAIL_SUBJECT_MAX} characters).` };

  if (mode === 'body') {
    if (!fields.heading.trim()) return { ok: false, error: 'The heading is required.' };
    if (!fields.message.trim()) return { ok: false, error: 'The message is required.' };
    for (const name of ['heading', 'message', 'footnote'] as const) {
      if (fields[name].length > EMAIL_FIELD_MAX[name]) {
        return { ok: false, error: `The ${name} is too long (max ${EMAIL_FIELD_MAX[name]} characters).` };
      }
    }
  }

  const html = mode === 'body' ? buildEmailHtml(fields) : typeof input.html === 'string' ? input.html : '';

  if (!html.trim()) return { ok: false, error: 'The HTML is required.' };
  if (html.length > EMAIL_HTML_MAX) return { ok: false, error: `The HTML is too long (max ${EMAIL_HTML_MAX.toLocaleString('en-US')} characters).` };
  if (/<\s*script\b/i.test(html) || /\son[a-z]+\s*=/i.test(html) || /javascript\s*:/i.test(html)) {
    return { ok: false, error: 'Scripts and event handlers are not allowed in an email.' };
  }

  const known = new Set(def.placeholders.map((ph) => ph.name));
  const unknown = usedPlaceholders(`${subject}\n${html}`).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.map((n) => `{{${n}}}`).join(', ')}.` };
  }

  return { ok: true, value: { subject, mode, html, fields } };
}
