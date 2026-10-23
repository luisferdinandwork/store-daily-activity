// lib/email/issue-emails.ts
//
// The email copy of an issue notification (same title / body as the in-app one).
// The wording and layout come from the editable `issue_notification` template
// (lib/email/email-templates.ts, edited at /it/email-templates); this file only
// works out the values that go into its placeholders.

import { APP_NAME, formatWib } from '@/lib/email/password-reset-emails';
import {
  DETAILS_SAMPLE_ROWS,
  EMAIL_TEMPLATES,
  buttonLink,
  cleanDetailRows,
  renderEmailTemplate,
} from '@/lib/email/email-templates';

export interface IssueEmailInput {
  title: string;
  body?: string;
  storeLabel: string | null;
  areaName: string | null;
  at: Date;
  /** Absolute link to the issues page; omitted when the deployment URL is not configured. */
  link: string | null;
}

const OPEN_LINK_LABEL = 'Buka halaman Issues';

export function issueEmailVars(input: IssueEmailInput): Record<string, string> {
  const rows: [string, string][] = [];
  if (input.storeLabel) rows.push(['Toko', input.storeLabel]);
  if (input.areaName) rows.push(['Area', input.areaName]);
  const time = formatWib(input.at);
  rows.push(['Waktu', time]);

  return {
    title: input.title,
    body: input.body ?? '',
    store: input.storeLabel ?? '',
    area: input.areaName ?? '',
    time,
    link: input.link ?? '',
    appName: APP_NAME,
    detailsTable: cleanDetailRows(rows),
    openLink: input.link ? buttonLink(input.link, OPEN_LINK_LABEL) : '',
  };
}

/** Values for the IT preview and the test email. */
export function sampleIssueEmailVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const ph of EMAIL_TEMPLATES.issue_notification.placeholders) vars[ph.name] = ph.sample;
  vars.detailsTable = cleanDetailRows(DETAILS_SAMPLE_ROWS);
  vars.openLink = buttonLink(vars.link, OPEN_LINK_LABEL);
  return vars;
}

export function renderIssueEmail(template: { subject: string; html: string }, vars: Record<string, string>) {
  return renderEmailTemplate('issue_notification', template, vars);
}
