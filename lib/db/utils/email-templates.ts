// lib/db/utils/email-templates.ts
//
// Read / save the IT-editable email templates declared in
// lib/email/email-templates.ts. A template with no email_templates row — or one
// that can't be read — is at its built-in default, so an email always goes out.

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { emailTemplates, users } from '@/lib/db/schema';
import {
  EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_KEYS,
  parseBodyFields,
  type EmailBodyFields,
  type EmailTemplateKey,
  type EmailTemplateMode,
  type EmailTemplateValue,
} from '@/lib/email/email-templates';

export interface StoredEmailTemplate {
  subject: string;
  html: string;
  isCustom: boolean;
}

/** What the send path needs: the stored (or default) subject + HTML. */
export async function getEmailTemplate(key: EmailTemplateKey): Promise<StoredEmailTemplate> {
  const def = EMAIL_TEMPLATES[key];
  try {
    const [row] = await db
      .select({ subject: emailTemplates.subject, html: emailTemplates.html })
      .from(emailTemplates)
      .where(eq(emailTemplates.key, key))
      .limit(1);
    if (row) return { subject: row.subject, html: row.html, isCustom: true };
  } catch (err) {
    console.error(`[email-templates] reading ${key} failed — using the default`, err);
  }
  return { subject: def.defaultSubject, html: def.defaultHtml, isCustom: false };
}

export interface EmailTemplateState {
  key: EmailTemplateKey;
  title: string;
  description: string;
  placeholders: readonly { name: string; description: string; html: boolean; sample: string }[];
  subject: string;
  mode: EmailTemplateMode;
  html: string;
  fields: EmailBodyFields;
  defaultSubject: string;
  defaultHtml: string;
  defaultFields: EmailBodyFields;
  isCustom: boolean;
  /** Null until IT saves the first change. */
  updatedAt: string | null;
  updatedByName: string | null;
}

export async function listEmailTemplates(): Promise<EmailTemplateState[]> {
  const rows = await db
    .select({
      key: emailTemplates.key,
      subject: emailTemplates.subject,
      mode: emailTemplates.mode,
      html: emailTemplates.html,
      fields: emailTemplates.fields,
      updatedAt: emailTemplates.updatedAt,
      updatedByName: users.name,
    })
    .from(emailTemplates)
    .leftJoin(users, eq(users.id, emailTemplates.updatedBy));
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return EMAIL_TEMPLATE_KEYS.map((key) => {
    const def = EMAIL_TEMPLATES[key];
    const row = byKey.get(key);
    return {
      key,
      title: def.title,
      description: def.description,
      placeholders: def.placeholders,
      subject: row?.subject ?? def.defaultSubject,
      // The built-in default is what Body mode stands for.
      mode: row ? (row.mode === 'body' ? 'body' : 'html') : 'body',
      html: row?.html ?? def.defaultHtml,
      fields: parseBodyFields(row?.fields, def.defaultFields),
      defaultSubject: def.defaultSubject,
      defaultHtml: def.defaultHtml,
      defaultFields: def.defaultFields,
      isCustom: Boolean(row),
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedByName: row?.updatedByName ?? null,
    };
  });
}

export async function saveEmailTemplate(
  key: EmailTemplateKey,
  value: EmailTemplateValue,
  actorId: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(emailTemplates)
    .values({ key, ...value, updatedBy: actorId, updatedAt: now })
    .onConflictDoUpdate({
      target: emailTemplates.key,
      set: { ...value, updatedBy: actorId, updatedAt: now },
    });
}

/** Back to the built-in default. */
export async function resetEmailTemplate(key: EmailTemplateKey): Promise<void> {
  await db.delete(emailTemplates).where(eq(emailTemplates.key, key));
}
