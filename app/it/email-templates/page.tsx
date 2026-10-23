'use client';
// app/it/email-templates/page.tsx — IT only.
//
// Edit the emails the app sends (today: the issue notification), two ways:
//   • Body — a heading, a message and two switches inside the clean PRISM layout;
//   • HTML — the whole email as raw HTML.
// {{placeholders}} are replaced when the email goes out; the preview on the
// right uses sample values. A saved template applies to the next email; "Reset
// to default" deletes it and brings the built-in one back.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Code2, FileText, Loader2, Mail, RotateCcw, Save, Send, Shield } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  EMAIL_FIELD_MAX,
  EMAIL_HTML_MAX,
  EMAIL_SUBJECT_MAX,
  buildEmailHtml,
  renderEmailTemplate,
  usedPlaceholders,
  type EmailBodyFields,
  type EmailTemplateKey,
  type EmailTemplateMode,
} from '@/lib/email/email-templates';
import type { EmailTemplateState } from '@/lib/db/utils/email-templates';

type SampleVars = Record<string, Record<string, string>>;
type FieldId = 'subject' | 'heading' | 'message' | 'footnote' | 'html';

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error ?? 'Request failed');
  return json;
}

function formatChangedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-cyan-400 focus:outline-none';

function Counter({ value, max }: { value: number; max: number }) {
  return <span className="font-semibold tabular-nums text-slate-400">{value.toLocaleString('en-US')}/{max.toLocaleString('en-US')}</span>;
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-cyan-600"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );
}

// ─── One template editor ──────────────────────────────────────────────────────

function TemplateEditor({
  template, sample, onChanged,
}: {
  template: EmailTemplateState;
  sample: Record<string, string>;
  onChanged: (templates: EmailTemplateState[]) => void;
}) {
  const [mode, setMode] = useState<EmailTemplateMode>(template.mode);
  const [subject, setSubject] = useState(template.subject);
  const [fields, setFields] = useState<EmailBodyFields>(template.fields);
  const [html, setHtml] = useState(template.html);
  const [busy, setBusy] = useState<'save' | 'test' | 'reset' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBody, setConfirmBody] = useState(false);

  const refs = useRef<Partial<Record<FieldId, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  // Which field the placeholder chips insert into: whichever was focused last.
  const lastField = useRef<FieldId>('message');

  const built = useMemo(() => buildEmailHtml(fields), [fields]);
  const effectiveHtml = mode === 'body' ? built : html;

  const dirty =
    mode !== template.mode ||
    subject !== template.subject ||
    (mode === 'body'
      ? JSON.stringify(fields) !== JSON.stringify(template.fields)
      : html !== template.html);

  const knownNames = useMemo(() => new Set(template.placeholders.map((p) => p.name)), [template.placeholders]);
  const unknown = useMemo(
    () => usedPlaceholders(`${subject}\n${effectiveHtml}`).filter((n) => !knownNames.has(n)),
    [subject, effectiveHtml, knownNames],
  );

  const preview = useMemo(
    () => renderEmailTemplate(template.key as EmailTemplateKey, { subject, html: effectiveHtml }, sample),
    [template.key, subject, effectiveHtml, sample],
  );

  const setField = <K extends keyof EmailBodyFields>(key: K, value: EmailBodyFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  function switchMode(next: EmailTemplateMode) {
    if (next === mode) return;
    if (next === 'html') {
      // Start the HTML from exactly what the Body fields produce.
      setHtml(built);
      lastField.current = 'html';
      setMode('html');
      return;
    }
    // Back to Body: the Body fields rebuild the email, so hand-written HTML would be lost.
    if (html.trim() !== built.trim()) { setConfirmBody(true); return; }
    lastField.current = 'message';
    setMode('body');
  }

  function insert(name: string) {
    const token = `{{${name}}}`;
    let target: FieldId = lastField.current;
    if (mode === 'body' && target === 'html') target = 'message';
    if (mode === 'html' && target !== 'subject') target = 'html';
    const el = refs.current[target];
    const current =
      target === 'subject' ? subject : target === 'html' ? html : fields[target as keyof EmailBodyFields] as string;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    if (target === 'subject') setSubject(next);
    else if (target === 'html') setHtml(next);
    else setField(target as 'heading' | 'message' | 'footnote', next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const payload = () => ({ subject, mode, html: effectiveHtml, fields });

  async function save() {
    setBusy('save');
    try {
      const json = await api(`/api/it/email-templates/${template.key}`, { method: 'PUT', body: JSON.stringify(payload()) });
      onChanged(json.templates);
      toast.success(json.message ?? 'Saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy('test');
    try {
      const json = await api(`/api/it/email-templates/${template.key}/test`, { method: 'POST', body: JSON.stringify(payload()) });
      toast.success(json.message ?? 'Test email sent.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send the test email');
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy('reset');
    try {
      const json = await api(`/api/it/email-templates/${template.key}`, { method: 'DELETE' });
      onChanged(json.templates);
      toast.success(json.message ?? 'Back to the default.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reset');
    } finally {
      setBusy(null);
      setConfirmReset(false);
    }
  }

  const label = 'text-xs font-bold text-slate-600';
  const frame = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${preview.html}</body></html>`;
  const chips = template.placeholders.filter((ph) => mode === 'html' || !ph.html);

  const reg = (id: FieldId) => (el: HTMLInputElement | HTMLTextAreaElement | null) => { refs.current[id] = el; };
  const focus = (id: FieldId) => () => { lastField.current = id; };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">{template.title}</h2>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                template.isCustom ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-500',
              )}
            >
              {template.isCustom ? 'Customised' : 'Default'}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">{template.description}</p>
          {template.updatedAt && (
            <p className="mt-1 text-[11px] text-slate-400">
              Last saved {formatChangedAt(template.updatedAt)}{template.updatedByName ? ` by ${template.updatedByName}` : ''}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null || !template.isCustom}
            onClick={() => setConfirmReset(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
          </button>
          <button
            type="button"
            disabled={busy !== null || unknown.length > 0}
            onClick={() => void sendTest()}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 disabled:opacity-50"
          >
            {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send test to me
          </button>
          <button
            type="button"
            disabled={busy !== null || !dirty || unknown.length > 0}
            onClick={() => void save()}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-2">
        {/* Editor */}
        <div className="min-w-0 space-y-4">
          {/* Body / HTML switch */}
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="tablist" aria-label="Edit mode">
            {([
              { id: 'body', label: 'Body', Icon: FileText },
              { id: 'html', label: 'HTML', Icon: Code2 },
            ] as const).map(({ id, label: text, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => switchMode(id)}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-md px-3.5 text-xs font-bold transition',
                  mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {text}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className={label}>Placeholders <span className="font-normal text-slate-400">— click to insert at the cursor</span></p>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((ph) => (
                <button
                  key={ph.name}
                  type="button"
                  title={ph.description}
                  onClick={() => insert(ph.name)}
                  className={cn(
                    'rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition-colors',
                    ph.html
                      ? 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {`{{${ph.name}}}`}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">
              {mode === 'body'
                ? 'Plain-text values, escaped for you. The details list and the button are the two switches below.'
                : 'Grey ones are plain text (escaped for you). Purple ones are ready-made HTML pieces, inserted as they are.'}
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className={cn(label, 'flex items-center justify-between')}>
              Subject <Counter value={subject.length} max={EMAIL_SUBJECT_MAX} />
            </span>
            <input
              ref={reg('subject') as React.Ref<HTMLInputElement>}
              value={subject}
              maxLength={EMAIL_SUBJECT_MAX}
              onFocus={focus('subject')}
              onChange={(e) => setSubject(e.target.value)}
              className={cn(inputClass, 'h-10')}
            />
          </label>

          {mode === 'body' ? (
            <>
              <label className="block space-y-1.5">
                <span className={cn(label, 'flex items-center justify-between')}>
                  Heading <Counter value={fields.heading.length} max={EMAIL_FIELD_MAX.heading} />
                </span>
                <input
                  ref={reg('heading') as React.Ref<HTMLInputElement>}
                  value={fields.heading}
                  maxLength={EMAIL_FIELD_MAX.heading}
                  onFocus={focus('heading')}
                  onChange={(e) => setField('heading', e.target.value)}
                  className={cn(inputClass, 'h-10')}
                />
              </label>

              <label className="block space-y-1.5">
                <span className={cn(label, 'flex items-center justify-between')}>
                  Message <Counter value={fields.message.length} max={EMAIL_FIELD_MAX.message} />
                </span>
                <textarea
                  ref={reg('message') as React.Ref<HTMLTextAreaElement>}
                  value={fields.message}
                  maxLength={EMAIL_FIELD_MAX.message}
                  onFocus={focus('message')}
                  onChange={(e) => setField('message', e.target.value)}
                  rows={7}
                  className={cn(inputClass, 'resize-y py-2 leading-relaxed')}
                />
                <span className="block text-[11px] text-slate-400">A blank line starts a new paragraph.</span>
              </label>

              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle
                  checked={fields.showDetails}
                  onChange={(v) => setField('showDetails', v)}
                  label="Show details"
                  hint="Store, area and time under the message."
                />
                <Toggle
                  checked={fields.showOpenLink}
                  onChange={(v) => setField('showOpenLink', v)}
                  label="Show button"
                  hint="“Buka halaman Issues” (only when the server URL is set)."
                />
              </div>

              <label className="block space-y-1.5">
                <span className={cn(label, 'flex items-center justify-between')}>
                  Footnote <Counter value={fields.footnote.length} max={EMAIL_FIELD_MAX.footnote} />
                </span>
                <input
                  ref={reg('footnote') as React.Ref<HTMLInputElement>}
                  value={fields.footnote}
                  maxLength={EMAIL_FIELD_MAX.footnote}
                  onFocus={focus('footnote')}
                  onChange={(e) => setField('footnote', e.target.value)}
                  className={cn(inputClass, 'h-10')}
                />
                <span className="block text-[11px] text-slate-400">
                  Small grey text under the card, above the standard “sent automatically” line. Can be empty.
                </span>
              </label>
            </>
          ) : (
            <label className="block space-y-1.5">
              <span className={cn(label, 'flex items-center justify-between')}>
                HTML <Counter value={html.length} max={EMAIL_HTML_MAX} />
              </span>
              <textarea
                ref={reg('html') as React.Ref<HTMLTextAreaElement>}
                value={html}
                spellCheck={false}
                onFocus={focus('html')}
                onChange={(e) => setHtml(e.target.value)}
                rows={22}
                className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-800 focus:border-cyan-400 focus:outline-none"
              />
              <span className="block text-[11px] text-slate-400">
                Use tables and inline styles; Outlook ignores most modern CSS. Scripts and event handlers are not allowed.
                Switching back to Body rebuilds the email from the Body fields.
              </span>
            </label>
          )}

          {unknown.length > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              Unknown placeholder{unknown.length > 1 ? 's' : ''}: {unknown.map((n) => `{{${n}}}`).join(', ')}. Fix before saving.
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="min-w-0 space-y-2">
          <p className={label}>Preview <span className="font-normal text-slate-400">— with sample values</span></p>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="text-slate-400">Subject: </span>
              <span className="font-semibold text-slate-800">{preview.subject}</span>
            </div>
            {/* sandbox="" — no scripts, no navigation: it is only a picture of the email. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={frame}
              className="h-[560px] w-full bg-white"
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset to the default email?"
        description="Your customised subject and email are deleted. The next email uses the built-in template again."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        tone="danger"
        icon={RotateCcw}
        busy={busy === 'reset'}
        onConfirm={() => void reset()}
      />

      <ConfirmDialog
        open={confirmBody}
        onOpenChange={setConfirmBody}
        title="Switch back to Body?"
        description="The email is rebuilt from the Body fields, so the HTML you wrote by hand is discarded (until you save, the stored version is untouched)."
        confirmLabel="Switch to Body"
        cancelLabel="Keep HTML"
        tone="primary"
        icon={FileText}
        onConfirm={() => { lastField.current = 'message'; setMode('body'); setConfirmBody(false); }}
      />
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmailTemplatesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isIt = session?.user?.role === 'it';

  const [templates, setTemplates] = useState<EmailTemplateState[]>([]);
  const [sampleVars, setSampleVars] = useState<SampleVars>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isIt) router.replace('/it');
  }, [authStatus, session, isIt, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await api('/api/it/email-templates');
      setTemplates(json.templates);
      setSampleVars(json.sampleVars ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the email templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isIt) void load(); }, [isIt, load]);

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
    </div>
  );

  if (!isIt) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only IT can edit email templates.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="IT · Configuration"
        title="Email Templates"
        subtitle={loading ? 'Loading…' : `${templates.length} template${templates.length !== 1 ? 's' : ''}`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <p className="text-xs text-slate-500">
          The wording and layout of the emails PRISM sends. A saved change applies to the next email. Emails go out as
          no-reply@panatradeprestasi.com.
        </p>

        {loading && templates.length === 0 ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>
        ) : templates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <Mail className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No email templates</p>
          </div>
        ) : (
          templates.map((t) => (
            <TemplateEditor
              // Remount after a save / reset so "dirty" is measured against the stored copy.
              key={`${t.key}:${t.updatedAt ?? 'default'}`}
              template={t}
              sample={sampleVars[t.key] ?? {}}
              onChanged={setTemplates}
            />
          ))
        )}
      </div>
    </div>
  );
}
