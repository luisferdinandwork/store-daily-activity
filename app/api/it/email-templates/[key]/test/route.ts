// app/api/it/email-templates/[key]/test/route.ts
//
// POST — { subject, mode, html?, fields? } (the editor's current, maybe unsaved text) is
// rendered with sample values and mailed to the IT user's OWN email only.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { resolveItScope } from '@/lib/auth/it-scope';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { isEmailTemplateKey, resolveEmailTemplate } from '@/lib/email/email-templates';
import { sendMail } from '@/lib/email/graph-mail';
import { renderIssueEmail, sampleIssueEmailVars } from '@/lib/email/issue-emails';

type Ctx = { params: Promise<{ key: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { key } = await params;
  if (!isEmailTemplateKey(key)) {
    return NextResponse.json({ success: false, error: 'Unknown email template.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const checked = resolveEmailTemplate(key, {
    subject: body?.subject,
    mode: body?.mode,
    html: body?.html,
    fields: body?.fields,
  });
  if (!checked.ok) {
    return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
  }

  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, scope.userId)).limit(1);
  if (!me?.email) {
    return NextResponse.json(
      { success: false, error: 'Your account has no email. Add one in IT Users first: test emails go to your own address.' },
      { status: 400 },
    );
  }

  const message = renderIssueEmail(checked.value, sampleIssueEmailVars());
  const result = await sendMail({ to: me.email, ...message, subject: `[TEST] ${message.subject}` });
  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    message:
      result.mode === 'console'
        ? `Mail is not configured here, so the test email was printed to the server console (${me.email}).`
        : `Test email sent to ${me.email}.`,
  });
}
