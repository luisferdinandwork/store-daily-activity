// app/api/it/email-templates/[key]/route.ts
//
// PUT    — { subject, mode: 'body' | 'html', html?, fields? } saves the template (checked:
//          no scripts, only known placeholders). In 'body' mode the HTML is built from `fields`.
// DELETE — back to the built-in default.
// IT-only.

import { NextRequest, NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { listEmailTemplates, resetEmailTemplate, saveEmailTemplate } from '@/lib/db/utils/email-templates';
import { EMAIL_TEMPLATES, isEmailTemplateKey, resolveEmailTemplate } from '@/lib/email/email-templates';

type Ctx = { params: Promise<{ key: string }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
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

  try {
    await saveEmailTemplate(key, checked.value, scope.userId);
    console.info(`[email-templates] ${key} saved by ${scope.userId}`);
    return NextResponse.json({
      success: true,
      templates: await listEmailTemplates(),
      message: `${EMAIL_TEMPLATES[key].title} saved.`,
    });
  } catch (err) {
    console.error('[PUT /api/it/email-templates/[key]]', err);
    return NextResponse.json({ success: false, error: 'Failed to save the template.' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { key } = await params;
  if (!isEmailTemplateKey(key)) {
    return NextResponse.json({ success: false, error: 'Unknown email template.' }, { status: 404 });
  }

  try {
    await resetEmailTemplate(key);
    console.info(`[email-templates] ${key} reset to default by ${scope.userId}`);
    return NextResponse.json({
      success: true,
      templates: await listEmailTemplates(),
      message: `${EMAIL_TEMPLATES[key].title} is back to the default.`,
    });
  } catch (err) {
    console.error('[DELETE /api/it/email-templates/[key]]', err);
    return NextResponse.json({ success: false, error: 'Failed to reset the template.' }, { status: 500 });
  }
}
