// app/api/it/email-templates/route.ts
//
// GET — every editable email (lib/email/email-templates.ts) with its current
// subject / HTML, its built-in default and its placeholders. IT-only.

import { NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { listEmailTemplates } from '@/lib/db/utils/email-templates';
import { sampleIssueEmailVars } from '@/lib/email/issue-emails';

export async function GET() {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  try {
    return NextResponse.json({
      success: true,
      templates: await listEmailTemplates(),
      // Values for the preview (the two html placeholders are built server-side).
      sampleVars: { issue_notification: sampleIssueEmailVars() },
    });
  } catch (err) {
    console.error('[GET /api/it/email-templates]', err);
    return NextResponse.json({ success: false, error: 'Failed to load the email templates.' }, { status: 500 });
  }
}
