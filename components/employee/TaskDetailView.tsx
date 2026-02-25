'use client';
// components/employee/TaskDetailView.tsx

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import type { AssignedTask, FormField } from '@/app/employee/tasks/page';

interface Props {
  task: AssignedTask;
  onBack: () => void;
}

// ─── Form field renderer ──────────────────────────────────────────────────────
function DynamicField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (id: string, val: unknown) => void;
}) {
  const shared = {
    className: 'form-input',
    id: `field-${field.id}`,
  };

  switch (field.type) {
    case 'text':
      return (
        <input
          {...shared}
          type="text"
          placeholder={field.placeholder ?? ''}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          {...shared}
          type="number"
          inputMode="decimal"
          placeholder={field.placeholder ?? ''}
          value={(value as string) ?? ''}
          min={field.validation?.min}
          max={field.validation?.max}
          onChange={(e) => onChange(field.id, e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    case 'textarea':
      return (
        <textarea
          {...shared}
          placeholder={field.placeholder ?? ''}
          value={(value as string) ?? ''}
          rows={3}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );
    case 'select':
      return (
        <select
          {...shared}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(field.id, e.target.value)}
        >
          <option value="">Select…</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'checkbox':
      return (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(field.id, e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
    case 'date':
      return (
        <input
          {...shared}
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );
    case 'time':
      return (
        <input
          {...shared}
          type="time"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );
    default:
      return null;
  }
}

// ─── Camera / photo section ───────────────────────────────────────────────────
function CameraCapture({
  maxAttachments,
  required,
  urls,
  onUrls,
  disabled,
}: {
  maxAttachments: number;
  required: boolean;
  urls: string[];
  onUrls: (urls: string[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const trigger = () => {
    if (disabled || uploading || urls.length >= maxAttachments) return;
    inputRef.current?.click();
  };

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const remaining = maxAttachments - urls.length;
    const toUpload = files.slice(0, remaining);

    setUploading(true);
    try {
      const newUrls = await Promise.all(
        toUpload.map(async (file) => {
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch('/api/employee/tasks/upload', { method: 'POST', body: fd });
          if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
          return (await res.json()).url as string;
        }),
      );
      onUrls([...urls, ...newUrls]);
      toast.success(`${newUrls.length} photo${newUrls.length > 1 ? 's' : ''} captured`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      // Reset input so same file can be re-selected if needed
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = (i: number) => {
    onUrls(urls.filter((_, idx) => idx !== i));
  };

  return (
    <div className="camera-section">
      {/* Hidden camera input — capture="environment" forces rear camera, no gallery */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={maxAttachments > 1}
        onChange={handleCapture}
        style={{ display: 'none' }}
        aria-hidden
      />

      <div className="camera-grid">
        {/* Existing photos */}
        {urls.map((url, i) => (
          <div key={i} className="cam-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Photo ${i + 1}`} className="cam-img" />
            <button
              type="button"
              className="cam-remove"
              onClick={() => remove(i)}
              aria-label="Remove photo"
            >
              ✕
            </button>
          </div>
        ))}

        {/* Capture button (shows until max reached) */}
        {urls.length < maxAttachments && (
          <button
            type="button"
            className={`cam-add${uploading ? ' loading' : ''}`}
            onClick={trigger}
            disabled={disabled || uploading}
          >
            {uploading ? (
              <div className="cam-spinner" />
            ) : (
              <>
                <span className="cam-add-icon">📷</span>
                <span className="cam-add-label">Take Photo</span>
              </>
            )}
          </button>
        )}
      </div>

      {required && urls.length === 0 && (
        <p className="field-hint error-hint">At least one photo is required</p>
      )}
      {urls.length > 0 && (
        <p className="field-hint">
          {urls.length}/{maxAttachments} photo{urls.length > 1 ? 's' : ''} captured
        </p>
      )}
    </div>
  );
}

// ─── Main Detail Component ────────────────────────────────────────────────────
export default function TaskDetailView({ task, onBack }: Props) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [photoUrls, setPhotoUrls] = useState<string[]>(task.employeeTask.attachmentUrls ?? []);
  const [notes, setNotes] = useState(task.employeeTask.notes ?? '');
  const [submitting, setSubmitting] = useState(false);

  const { task: t, employeeTask: et } = task;
  const isCompleted = et.status === 'completed';

  const setField = (id: string, val: unknown) =>
    setFormValues((prev) => ({ ...prev, [id]: val }));

  const validate = (): string | null => {
    if (t.requiresAttachment && photoUrls.length === 0) {
      return 'Please take at least one photo before submitting';
    }
    if (t.requiresForm && t.formSchema) {
      for (const field of t.formSchema.fields) {
        if (field.type === 'checkbox') continue; // checkboxes are optional booleans
        const val = formValues[field.id];
        if (field.required && (val === undefined || val === null || val === '')) {
          return `"${field.label}" is required`;
        }
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeTaskId: et.id,
          formData: t.requiresForm ? formValues : undefined,
          attachmentUrls: photoUrls.length > 0 ? photoUrls : undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to submit');

      toast.success('Task completed! 🎉');
      setTimeout(onBack, 800);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

        :root {
          --sand: #f8f7f5;
          --ink: #1a1a1a;
          --mid: #6b6b6b;
          --light: #e8e6e1;
          --accent: #ff6b35;
          --green: #2d9e6b;
          --amber: #e8a020;
          --red: #e03a3a;
        }

        .detail-page {
          background: var(--sand);
          min-height: 100dvh;
          font-family: 'DM Sans', sans-serif;
          padding-bottom: 100px;
        }

        /* Header */
        .detail-header {
          background: var(--ink); color: #fff;
          padding: 48px 20px 28px;
          position: relative;
        }

        .detail-back {
          display: flex; align-items: center; gap: 6px;
          font-family: 'Syne', sans-serif;
          font-size: 12px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.1em;
          color: rgba(255,255,255,0.5);
          background: none; border: none; cursor: pointer;
          margin-bottom: 16px; padding: 0;
          -webkit-tap-highlight-color: transparent;
        }

        .detail-back:active { color: #fff; }

        .detail-title {
          font-family: 'Syne', sans-serif;
          font-size: 22px; font-weight: 800;
          letter-spacing: -0.02em;
          line-height: 1.2;
        }

        .detail-desc { font-size: 13px; color: rgba(255,255,255,0.45); margin-top: 6px; }

        .detail-badges {
          display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px;
        }

        .detail-badge {
          font-size: 10px; font-weight: 700; font-family: 'Syne', sans-serif;
          padding: 3px 10px; border-radius: 99px;
          background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6);
          text-transform: uppercase; letter-spacing: 0.06em;
        }

        .detail-badge.orange { background: rgba(255,107,53,0.2); color: var(--accent); }
        .detail-badge.green  { background: rgba(45,158,107,0.2); color: #4cd4a0; }

        /* Completed banner */
        .completed-banner {
          margin: 16px 16px 0;
          background: rgba(45,158,107,0.1);
          border: 1.5px solid rgba(45,158,107,0.25);
          border-radius: 12px;
          padding: 14px 16px;
          display: flex; align-items: center; gap: 10px;
          color: var(--green);
          font-weight: 500; font-size: 13px;
        }

        /* Body */
        .detail-body { padding: 20px 16px; display: flex; flex-direction: column; gap: 20px; }

        /* Section card */
        .section-card {
          background: #fff;
          border-radius: 16px;
          padding: 18px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.05);
        }

        .section-title {
          font-family: 'Syne', sans-serif;
          font-size: 11px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.1em;
          color: var(--mid);
          margin-bottom: 14px;
        }

        /* Form fields */
        .field-group { margin-bottom: 14px; }
        .field-group:last-child { margin-bottom: 0; }

        .field-label {
          display: block;
          font-size: 12px; font-weight: 500;
          color: var(--mid);
          margin-bottom: 6px;
        }

        .field-required { color: var(--accent); margin-left: 2px; }

        .form-input {
          width: 100%;
          background: var(--sand);
          border: 1.5px solid var(--light);
          border-radius: 10px;
          padding: 11px 14px;
          font-size: 15px;
          font-family: 'DM Sans', sans-serif;
          color: var(--ink);
          outline: none;
          transition: border-color 0.15s;
          appearance: none;
          -webkit-appearance: none;
        }

        .form-input:focus { border-color: var(--ink); background: #fff; }
        .form-input[disabled] { opacity: 0.5; }

        textarea.form-input { resize: vertical; min-height: 80px; }

        /* Checkbox */
        .checkbox-label {
          display: flex; align-items: center; gap: 10px;
          font-size: 14px; color: var(--ink); cursor: pointer;
          padding: 10px 0;
        }

        .checkbox-label input[type=checkbox] {
          width: 20px; height: 20px;
          accent-color: var(--accent);
          flex-shrink: 0;
        }

        /* Camera */
        .camera-section { }

        .camera-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }

        .cam-thumb {
          position: relative;
          aspect-ratio: 1;
          border-radius: 10px;
          overflow: hidden;
        }

        .cam-img { width: 100%; height: 100%; object-fit: cover; display: block; }

        .cam-remove {
          position: absolute; top: 4px; right: 4px;
          width: 22px; height: 22px;
          background: rgba(0,0,0,0.6);
          color: #fff; border: none; border-radius: 50%;
          font-size: 10px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }

        .cam-add {
          aspect-ratio: 1;
          border-radius: 10px;
          border: 2px dashed var(--light);
          background: var(--sand);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 4px; cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: border-color 0.15s, background 0.15s;
        }

        .cam-add:active:not([disabled]) {
          border-color: var(--accent);
          background: rgba(255,107,53,0.05);
        }

        .cam-add[disabled] { opacity: 0.4; cursor: not-allowed; }

        .cam-add-icon { font-size: 24px; }
        .cam-add-label { font-size: 10px; font-weight: 700; color: var(--mid); font-family: 'Syne', sans-serif; text-transform: uppercase; letter-spacing: 0.06em; }

        .cam-spinner {
          width: 24px; height: 24px;
          border: 2px solid var(--light);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        /* Hints */
        .field-hint { font-size: 11px; color: var(--mid); margin-top: 6px; }
        .error-hint { color: var(--red); }

        /* Notes */
        .notes-input {
          width: 100%;
          background: var(--sand);
          border: 1.5px solid var(--light);
          border-radius: 10px;
          padding: 12px 14px;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          color: var(--ink);
          outline: none;
          resize: vertical;
          min-height: 80px;
          transition: border-color 0.15s;
        }

        .notes-input:focus { border-color: var(--ink); background: #fff; }

        /* Submit button */
        .submit-btn {
          position: fixed;
          bottom: 72px; left: 16px; right: 16px;
          height: 56px;
          background: var(--ink);
          color: #fff;
          border: none;
          border-radius: 16px;
          font-family: 'Syne', sans-serif;
          font-size: 15px; font-weight: 800;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: transform 0.1s, background 0.15s;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          -webkit-tap-highlight-color: transparent;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }

        .submit-btn:active:not([disabled]) { transform: scale(0.98); }
        .submit-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
        .submit-btn.submitting { background: var(--green); }

        .submit-spinner {
          width: 18px; height: 18px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
      `}</style>

      <div className="detail-page">
        {/* Header */}
        <div className="detail-header">
          <button className="detail-back" onClick={onBack} type="button">
            ← Back
          </button>
          <h1 className="detail-title">{t.title}</h1>
          {t.description && <p className="detail-desc">{t.description}</p>}
          <div className="detail-badges">
            {t.shift && <span className="detail-badge">🕐 {t.shift} shift</span>}
            {t.requiresForm && <span className="detail-badge orange">📝 Form required</span>}
            {t.requiresAttachment && <span className="detail-badge orange">📷 Photo required</span>}
            {isCompleted && <span className="detail-badge green">✓ Completed</span>}
          </div>
        </div>

        {/* Completed banner */}
        {isCompleted && (
          <div className="completed-banner">
            <span>✓</span>
            <span>
              Completed at{' '}
              {et.completedAt
                ? new Date(et.completedAt).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' })
                : '—'}
            </span>
          </div>
        )}

        <div className="detail-body">
          {/* Dynamic Form */}
          {t.requiresForm && t.formSchema && t.formSchema.fields.length > 0 && (
            <div className="section-card">
              <div className="section-title">Task Form</div>
              {t.formSchema.fields.map((field) => (
                <div className="field-group" key={field.id}>
                  {field.type !== 'checkbox' && (
                    <label className="field-label" htmlFor={`field-${field.id}`}>
                      {field.label}
                      {field.required && <span className="field-required">*</span>}
                    </label>
                  )}
                  <DynamicField
                    field={field}
                    value={
                      isCompleted && et.formData
                        ? (et.formData as Record<string, unknown>)[field.id]
                        : formValues[field.id]
                    }
                    onChange={isCompleted ? () => {} : setField}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Photo Capture */}
          {t.requiresAttachment && (
            <div className="section-card">
              <div className="section-title">
                Photo Evidence
                {t.requiresAttachment && !isCompleted && (
                  <span className="field-required" style={{ marginLeft: 4 }}>*</span>
                )}
              </div>
              <CameraCapture
                maxAttachments={t.maxAttachments || 3}
                required={t.requiresAttachment}
                urls={photoUrls}
                onUrls={isCompleted ? () => {} : setPhotoUrls}
                disabled={isCompleted}
              />
            </div>
          )}

          {/* Notes */}
          <div className="section-card">
            <div className="section-title">Notes (Optional)</div>
            <textarea
              className="notes-input"
              placeholder="Add any additional notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isCompleted}
            />
          </div>
        </div>

        {/* Submit */}
        {!isCompleted && (
          <button
            className={`submit-btn${submitting ? ' submitting' : ''}`}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <div className="submit-spinner" />
                Submitting…
              </>
            ) : (
              'Complete Task'
            )}
          </button>
        )}
      </div>
    </>
  );
}