// lib/email/issue-emails.ts
//
// The email copy of an issue notification (same title / body as the in-app one).
// Reuses the layout of the "Lupa password" emails.

import {
  APP_NAME,
  BRAND,
  detailRows,
  esc,
  formatWib,
  layout,
  p,
  type Rendered,
  type Row,
} from '@/lib/email/password-reset-emails';

export interface IssueEmailInput {
  title: string;
  body?: string;
  storeLabel: string | null;
  areaName: string | null;
  at: Date;
  /** Absolute link to the issues page; omitted when the deployment URL is not configured. */
  link: string | null;
}

export function issueNotificationEmail(input: IssueEmailInput): Rendered {
  const rows: Row[] = [];
  if (input.storeLabel) rows.push(['Toko', input.storeLabel]);
  if (input.areaName) rows.push(['Area', input.areaName]);
  rows.push(['Waktu', formatWib(input.at)]);

  return {
    subject: `[${APP_NAME}] ${input.title}`,
    html: layout({
      heading: input.title,
      bodyHtml: [
        input.body ? p(esc(input.body)) : '',
        detailRows(rows),
        input.link ? p(`<a href="${esc(input.link)}" style="color:${BRAND};">Buka halaman Issues</a>`) : '',
      ]
        .filter(Boolean)
        .join('\n'),
      footnote: 'Anda menerima email ini karena issue ini diteruskan ke tim Anda.',
    }),
    text: [
      input.title,
      input.body ?? '',
      ...rows.map(([label, value]) => `${label}: ${value}`),
      input.link ?? '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
