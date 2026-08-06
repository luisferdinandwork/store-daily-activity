'use client';

// app/employee/issues/page.tsx — mobile-first issue reporting for store staff.
//
// Route chrome (logo/back button + notification bell) comes from the shared
// EmployeeHeader; this hero only carries page-specific content (title, stats).
//
// Status lifecycle: draft -> reported -> in_review -> solved -> completed.
// - draft issues are private and fully editable by the reporter
// - draft issues can be sent to OPS by changing status draft -> reported
// - the reporter resolves the issue by marking it "solved" (from reported
//   or in_review) — this happens BEFORE Ops gives final closure
// - OPS gives final confirmation by marking it "completed" — only once the
//   reporter has already marked it solved
// - the reporter can attach a one-time Berita Acara (BA) at ANY status,
//   including draft, independent of the status flow above
// - destinations support multiple roles/departments

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  Plus,
  X,
  Camera,
  Loader2,
  ChevronRight,
  Clock,
  CheckCircle2,
  Eye,
  ArrowLeft,
  Users,
  Wallet,
  Monitor,
  Building2,
  Send,
  Pencil,
  Trash2,
  Save,
  ShieldCheck,
  ClipboardCheck,
  UploadCloud,
  FileText,
  Paperclip,
  Image as ImageIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import CameraCapture from '@/components/shared/CameraCapture';
import {
  type Issue,
  type IssueStatus,
  type AssignableRole,
  STATUS_LABELS,
  STATUS_COLORS,
  fetchIssues,
  fetchAssignableRoles,
  createIssue,
  updateIssue,
  sendDraftIssue,
  markIssueSolved,
  deleteIssue,
  uploadIssueImages,
  uploadBaFiles,
  formatRelativeTime,
} from '@/lib/issues';

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'list' | 'new' | 'detail';

type IssueFormMode = 'create' | 'edit';

// Icon per destination role code, with a safe fallback for roles added later.
const ROLE_ICON: Record<string, LucideIcon> = {
  ops: Users,
  operation: Users,
  operations: Users,
  finance: Wallet,
  it: Monitor,
  audit: ShieldCheck,
};

const roleIcon = (code: string): LucideIcon => ROLE_ICON[code] ?? Building2;

function getIssueRoles(issue: Issue): Array<{ id: number; code: string; label: string; description?: string | null }> {
  if (Array.isArray(issue.assignedToRoles) && issue.assignedToRoles.length > 0) {
    return issue.assignedToRoles;
  }

  return issue.assignedTo ? [issue.assignedTo] : [];
}

function roleIdsFromIssue(issue: Issue): number[] {
  return getIssueRoles(issue).map((role) => role.id);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IssueStatus }) {
  const c = STATUS_COLORS[status];

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', c.bg, c.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function AssigneeChips({ issue }: { issue: Issue }) {
  const roles = getIssueRoles(issue);
  if (!roles.length) return null;

  return (
    <>
      {roles.map((role) => {
        const Icon = roleIcon(role.code);

        return (
          <span key={role.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Icon className="h-3 w-3" />
            {role.label}
          </span>
        );
      })}
    </>
  );
}

function IssueCard({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{issue.title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{issue.description}</p>
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={issue.status} />
        <AssigneeChips issue={issue} />
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(issue.createdAt)}
        </span>
      </div>
    </button>
  );
}

function ImagePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(() => URL.createObjectURL(file));

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={file.name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-black"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function ExistingImagePreview({ url, onRemove }: { url: string; onRemove: () => void }) {
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Existing attachment" className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-black"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** True for any file the browser reports as a rasterizable image — everything else (PDF, Word, Excel, …) gets a document icon instead of a thumbnail. */
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function docLabel(file: File): string {
  const ext = file.name.split('.').pop()?.toUpperCase();
  return ext && ext.length <= 5 ? ext : 'FILE';
}

/** BA attachment preview for a locally-picked File — renders a thumbnail for images, a document chip for anything else (PDF, Word, Excel). */
function BaFilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const isImage = isImageFile(file);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
      {isImage ? (
        src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={file.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5 text-center">
          <FileText className="h-6 w-6 text-violet-500" />
          <span className="line-clamp-2 text-[9px] font-semibold leading-tight text-muted-foreground">
            {docLabel(file)}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-black"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Read-only BA attachment view (already uploaded) — image opens the file directly; documents show as a labeled link since a PDF/doc can't be thumbnailed without extra work. */
function BaAttachmentLink({ url }: { url: string }) {
  const isImage = /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(url);
  const ext = url.split('.').pop()?.toUpperCase() ?? 'FILE';

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-violet-500/20 bg-muted transition-opacity hover:opacity-80"
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Berita Acara attachment" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-violet-500/5 px-1.5 text-center">
          <FileText className="h-6 w-6 text-violet-500" />
          <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">{ext}</span>
        </div>
      )}
    </a>
  );
}

function RolePicker({
  roles,
  rolesLoading,
  selectedIds,
  onToggle,
}: {
  roles: AssignableRole[];
  rolesLoading: boolean;
  selectedIds: number[];
  onToggle: (roleId: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Send to <span className="text-destructive">*</span>
      </label>

      {rolesLoading ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {roles.map((role) => {
            const Icon = roleIcon(role.code);
            const active = selectedIds.includes(role.id);

            return (
              <button
                key={role.id}
                type="button"
                onClick={() => onToggle(role.id)}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border-2 px-3 py-3 text-left transition-all active:scale-[0.98]',
                  active ? 'border-primary bg-primary/5' : 'border-border bg-muted/40 hover:border-primary/30',
                )}
              >
                <div className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}>
                  <Icon className="h-4 w-4" />
                </div>

                <div className="min-w-0">
                  <p className={cn('truncate text-sm font-bold', active ? 'text-primary' : 'text-foreground')}>
                    {role.label}
                  </p>
                  {role.description && <p className="truncate text-[10px] text-muted-foreground">{role.description}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── New / Edit Issue Form ────────────────────────────────────────────────────

function IssueForm({
  mode,
  issue,
  onSuccess,
  onCancel,
}: {
  mode: IssueFormMode;
  issue?: Issue;
  onSuccess: (issue: Issue) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(issue?.title ?? '');
  const [description, setDescription] = useState(issue?.description ?? '');
  const [images, setImages] = useState<File[]>([]);
  const [existingUrls, setExistingUrls] = useState<string[]>(issue?.attachmentUrls ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>(issue ? roleIdsFromIssue(issue) : []);

  const [cameraOpen, setCameraOpen] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;

    fetchAssignableRoles()
      .then((loadedRoles) => {
        if (!alive) return;

        setRoles(loadedRoles);

        if (!issue && loadedRoles.length) {
          setSelectedRoleIds([loadedRoles[0].id]);
        }
      })
      .catch(() => {
        if (alive) setError('Could not load destinations. Pull to refresh.');
      })
      .finally(() => {
        if (alive) setRolesLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [issue]);

  const addImage = useCallback((file: File) => {
    const remainingSlots = Math.max(0, 5 - existingUrls.length);

    setImages((prev) => [...prev, file].slice(0, remainingSlots));
  }, [existingUrls.length]);

  const addImagesFromGallery = useCallback((fileList: FileList | null) => {
    if (!fileList?.length) return;
    const remainingSlots = Math.max(0, 5 - existingUrls.length);

    setImages((prev) => [...prev, ...Array.from(fileList)].slice(0, remainingSlots));
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  }, [existingUrls.length]);

  const toggleRole = (roleId: number) => {
    setSelectedRoleIds((prev) => (
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId]
    ));
  };

  const submit = async (status: IssueStatus) => {
    setError(null);

    if (title.trim().length < 3) {
      setError('Title must be at least 3 characters.');
      return;
    }

    if (description.trim().length < 10) {
      setError('Please describe the issue in more detail (at least 10 characters).');
      return;
    }

    if (!selectedRoleIds.length) {
      setError('Please choose at least one destination.');
      return;
    }

    setLoading(true);

    try {
      let uploadedUrls: string[] = [];
      if (images.length > 0) {
        uploadedUrls = await uploadIssueImages(images, title.trim());
      }

      const attachmentUrls = [...existingUrls, ...uploadedUrls];

      const savedIssue = mode === 'edit' && issue
        ? await updateIssue(issue.id, {
            title: title.trim(),
            description: description.trim(),
            assignedToRoleIds: selectedRoleIds,
            attachmentUrls,
            status,
          })
        : await createIssue({
            title: title.trim(),
            description: description.trim(),
            assignedToRoleIds: selectedRoleIds,
            attachmentUrls,
            status,
          });

      onSuccess(savedIssue);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const totalImages = existingUrls.length + images.length;
  const titleText = mode === 'edit' ? 'Edit Draft Issue' : 'Report an Issue';
  const subtitleText = mode === 'edit' ? 'Update draft before sending to OPS' : 'Pick who should handle it';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="font-semibold text-foreground">{titleText}</h2>
          <p className="text-xs text-muted-foreground">{subtitleText}</p>
        </div>
      </div>

      <form className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5" onSubmit={(event) => event.preventDefault()}>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <RolePicker
          roles={roles}
          rolesLoading={rolesLoading}
          selectedIds={selectedRoleIds}
          onToggle={toggleRole}
        />

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Issue Title <span className="text-destructive">*</span>
          </label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Broken AC unit in back room"
            maxLength={120}
            className="w-full rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 transition-all focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <span className="self-end text-[11px] text-muted-foreground">{title.length}/120</span>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Description <span className="text-destructive">*</span>
          </label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe the issue clearly — what happened, when, and any relevant context..."
            rows={5}
            maxLength={2000}
            className="w-full resize-none rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 transition-all focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <span className="self-end text-[11px] text-muted-foreground">{description.length}/2000</span>
        </div>

        {/* Images */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Photos <span className="font-normal normal-case tracking-normal text-muted-foreground/50">(optional, up to 5)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {existingUrls.map((url) => (
              <ExistingImagePreview
                key={url}
                url={url}
                onRemove={() => setExistingUrls((prev) => prev.filter((item) => item !== url))}
              />
            ))}

            {images.map((file, index) => (
              <ImagePreview
                key={`${file.name}-${index}`}
                file={file}
                onRemove={() => setImages((prev) => prev.filter((_, idx) => idx !== index))}
              />
            ))}

            {totalImages < 5 && (
              <>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground/60 transition-colors hover:border-primary/40 hover:text-primary/60"
                >
                  <Camera className="h-5 w-5" />
                  <span className="text-[10px]">Camera</span>
                </button>

                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground/60 transition-colors hover:border-primary/40 hover:text-primary/60"
                >
                  <ImageIcon className="h-5 w-5" />
                  <span className="text-[10px]">Gallery</span>
                </button>
              </>
            )}
          </div>

          <input
            ref={galleryInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => addImagesFromGallery(e.target.files)}
          />

          <CameraCapture
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onCapture={(file) => { setCameraOpen(false); addImage(file); }}
            title="Issue Photo"
          />
        </div>

        <div className="flex-1" />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={loading || rolesLoading}
            onClick={() => submit('draft')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Draft
          </button>

          <button
            type="button"
            disabled={loading || rolesLoading}
            onClick={() => submit('reported')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Issue Detail ─────────────────────────────────────────────────────────────

function IssueDetail({
  issue,
  onBack,
  onIssueUpdated,
  onIssueDeleted,
}: {
  issue: Issue;
  onBack: () => void;
  onIssueUpdated: (issue: Issue) => void;
  onIssueDeleted: (issueId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [baCameraOpen, setBaCameraOpen] = useState(false);
  const [baFiles, setBaFiles] = useState<File[]>([]);
  const [baUploading, setBaUploading] = useState(false);
  const baFileInputRef = useRef<HTMLInputElement>(null);

  const steps: IssueStatus[] = ['draft', 'reported', 'in_review', 'solved', 'completed'];
  const currentIdx = steps.indexOf(issue.status);
  const canEditDraft = issue.canEdit ?? (issue.status === 'draft' && issue.isOwner !== false);
  const canDeleteDraft = issue.canDelete ?? canEditDraft;
  const canSendDraft = issue.canSendToOps ?? canEditDraft;
  const canMarkSolved = issue.canMarkSolved ?? false;
  const canUploadBa = issue.canUploadBa ?? false;

  const handleSendDraft = async () => {
    setActionError(null);
    setActionLoading(true);

    try {
      const updated = await sendDraftIssue(issue.id);
      onIssueUpdated(updated);
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to send draft to OPS.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkSolved = async () => {
    setActionError(null);
    setActionLoading(true);

    try {
      const updated = await markIssueSolved(issue.id);
      onIssueUpdated(updated);
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to mark issue solved.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUploadBa = async () => {
    if (!baFiles.length) return;
    setActionError(null);
    setBaUploading(true);

    try {
      const urls = await uploadBaFiles(baFiles, `${issue.title} - BA`);
      const updated = await updateIssue(issue.id, { baAttachmentUrls: urls });
      setBaFiles([]);
      onIssueUpdated(updated);
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to upload Berita Acara.');
    } finally {
      setBaUploading(false);
    }
  };

  const handleBaFilesPicked = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setBaFiles((prev) => [...prev, ...Array.from(fileList)].slice(0, 5));
    if (baFileInputRef.current) baFileInputRef.current.value = '';
  };

  const handleDelete = async () => {
    setActionError(null);

    const ok = window.confirm('Delete this draft issue?');
    if (!ok) return;

    setActionLoading(true);

    try {
      await deleteIssue(issue.id);
      onIssueDeleted(issue.id);
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to delete issue.');
    } finally {
      setActionLoading(false);
    }
  };

  if (editing) {
    return (
      <IssueForm
        mode="edit"
        issue={issue}
        onCancel={() => setEditing(false)}
        onSuccess={(updated) => {
          setEditing(false);
          onIssueUpdated(updated);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <button type="button" onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-foreground">{issue.title}</h2>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        {actionError && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {actionError}
          </div>
        )}

        {issue.status === 'draft' && issue.isOwner !== false && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Draft issue</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-700/80 dark:text-amber-300/80">
              This issue is still editable by store employee. Send it to OPS when the details are ready.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={issue.status} />
          <AssigneeChips issue={issue} />
          <span className="text-xs text-muted-foreground">Reported {formatRelativeTime(issue.createdAt)}</span>
        </div>

        {/* Status timeline */}
        <div className="flex items-center gap-0">
          {steps.map((status, index, arr) => {
            const done = index <= currentIdx;
            const isLast = index === arr.length - 1;

            return (
              <div key={status} className="flex flex-1 items-center">
                <div className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors',
                  done ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground',
                )}>
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                </div>
                <span className={cn('ml-1 mr-1 text-[10px] font-semibold', done ? 'text-primary' : 'text-muted-foreground')}>
                  {STATUS_LABELS[status]}
                </span>
                {!isLast && <div className={cn('mx-1 h-0.5 flex-1', index < currentIdx ? 'bg-primary' : 'bg-border')} />}
              </div>
            );
          })}
        </div>

        {/* Destination */}
        {getIssueRoles(issue).length > 0 && (
          <div className="rounded-2xl border border-border bg-muted/30 p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sent to</p>
            <div className="flex flex-col gap-2">
              {getIssueRoles(issue).map((role) => {
                const Icon = roleIcon(role.code);

                return (
                  <div key={role.id} className="flex items-center gap-3">
                    <Icon className="h-5 w-5 shrink-0 text-primary" />
                    <p className="text-sm font-semibold text-foreground">{role.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Description */}
        <div className="rounded-2xl border border-border bg-muted/30 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Description</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{issue.description}</p>
        </div>

        {/* Photos */}
        {issue.attachmentUrls.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Photos ({issue.attachmentUrls.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {issue.attachmentUrls.map((url, index) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-muted transition-opacity hover:opacity-80"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Attachment ${index + 1}`} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Berita Acara — uploadable at any status, including draft */}
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">
              <ClipboardCheck className="h-3.5 w-3.5" />
              Berita Acara
            </p>

            {issue.baAttachmentUrls.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {issue.baAttachmentUrls.map((url) => (
                    <BaAttachmentLink key={url} url={url} />
                  ))}
                </div>
                {issue.baUploadedAt && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Uploaded {formatRelativeTime(issue.baUploadedAt)}
                  </p>
                )}
              </>
            ) : canUploadBa ? (
              <>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Photos, PDF, Word, or Excel — one-time upload, up to 5 files. Can't be changed once submitted.
                </p>
                <div className="flex flex-wrap gap-2">
                  {baFiles.map((file, index) => (
                    <BaFilePreview
                      key={`${file.name}-${index}`}
                      file={file}
                      onRemove={() => setBaFiles((prev) => prev.filter((_, i) => i !== index))}
                    />
                  ))}

                  {baFiles.length < 5 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setBaCameraOpen(true)}
                        className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-violet-500/30 text-violet-500/60 transition-colors hover:border-violet-500/50 hover:text-violet-500"
                      >
                        <Camera className="h-5 w-5" />
                        <span className="text-[10px]">Camera</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => baFileInputRef.current?.click()}
                        className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-violet-500/30 text-violet-500/60 transition-colors hover:border-violet-500/50 hover:text-violet-500"
                      >
                        <Paperclip className="h-5 w-5" />
                        <span className="text-[10px]">Gallery/File</span>
                      </button>
                    </>
                  )}
                </div>

                <input
                  ref={baFileInputRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                  className="hidden"
                  onChange={(e) => handleBaFilesPicked(e.target.files)}
                />

                <CameraCapture
                  open={baCameraOpen}
                  onClose={() => setBaCameraOpen(false)}
                  onCapture={(file) => {
                    setBaCameraOpen(false);
                    setBaFiles((prev) => [...prev, file].slice(0, 5));
                  }}
                  title="Berita Acara Photo"
                />

                {baFiles.length > 0 && (
                  <button
                    type="button"
                    disabled={baUploading}
                    onClick={handleUploadBa}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                  >
                    {baUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                    Upload Berita Acara
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Not uploaded yet.</p>
            )}
          </div>

        {issue.solvedAt && (
          <div className="flex items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
            <ShieldCheck className="h-4 w-4 shrink-0 text-violet-500" />
            <p className="text-xs text-violet-600 dark:text-violet-400">Marked solved {formatRelativeTime(issue.solvedAt)}</p>
          </div>
        )}

        {issue.reviewedAt && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <Eye className="h-4 w-4 shrink-0 text-emerald-500" />
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Reviewed {formatRelativeTime(issue.reviewedAt)}</p>
          </div>
        )}

        {canMarkSolved && (
          <button
            type="button"
            disabled={actionLoading}
            onClick={handleMarkSolved}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 py-3.5 font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Mark as Solved
          </button>
        )}

        {(canEditDraft || canSendDraft || canDeleteDraft) && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={actionLoading || !canEditDraft}
              onClick={() => setEditing(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:opacity-60"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>

            <button
              type="button"
              disabled={actionLoading || !canSendDraft}
              onClick={handleSendDraft}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send to OPS
            </button>

            <button
              type="button"
              disabled={actionLoading || !canDeleteDraft}
              onClick={handleDelete}
              className="col-span-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 py-3.5 font-semibold text-destructive transition-all hover:bg-destructive/15 active:scale-[0.98] disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Delete Draft
            </button>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground/50">Ref: {issue.id.padStart(6, '0')}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IssuesPage() {
  const [view, setView] = useState<View>('list');
  const [issuesList, setIssuesList] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<IssueStatus | 'all'>('all');
  const [showSuccess, setShowSuccess] = useState(false);
  const [successText, setSuccessText] = useState('Issue reported! The team has been notified.');

  const loadIssues = useCallback(async () => {
    setLoading(true);

    try {
      setIssuesList(await fetchIssues());
    } catch {
      // silent — empty state shows
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

  const visibleIssues = useMemo(
    () => (filter === 'all' ? issuesList : issuesList.filter((issue) => issue.status === filter)),
    [issuesList, filter],
  );

  const stats = useMemo(() => ({
    reported:  issuesList.filter((issue) => issue.status === 'reported').length,
    inReview:  issuesList.filter((issue) => issue.status === 'in_review').length,
    solved:    issuesList.filter((issue) => issue.status === 'solved').length,
    completed: issuesList.filter((issue) => issue.status === 'completed').length,
  }), [issuesList]);

  const flashSuccess = (message: string) => {
    setSuccessText(message);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 4000);
  };

  const upsertIssue = (issue: Issue) => {
    setIssuesList((prev) => {
      const exists = prev.some((item) => item.id === issue.id);
      return exists
        ? prev.map((item) => (item.id === issue.id ? issue : item))
        : [issue, ...prev];
    });
    setSelected(issue);
  };

  const handleCreated = (issue: Issue) => {
    upsertIssue(issue);
    setView('list');
    flashSuccess(issue.status === 'draft' ? 'Draft saved. You can edit it before sending to OPS.' : 'Issue reported! The team has been notified.');
  };

  const handleUpdated = (issue: Issue) => {
    upsertIssue(issue);
    flashSuccess(
      issue.status === 'reported' ? 'Issue sent to OPS.' :
      issue.status === 'solved'   ? 'Marked as solved. Ops will confirm completion.' :
      'Issue updated.',
    );
  };

  const handleDeleted = (issueId: string) => {
    setIssuesList((prev) => prev.filter((issue) => issue.id !== issueId));
    setSelected(null);
    setView('list');
    flashSuccess('Draft deleted.');
  };

  const FILTERS: { value: IssueStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'reported', label: 'Reported' },
    { value: 'in_review', label: 'In Review' },
    { value: 'solved', label: 'Solved' },
    { value: 'completed', label: 'Completed' },
  ];

  if (view === 'new') {
    return (
      <div className="flex h-full flex-col bg-background pb-16">
        <IssueForm mode="create" onSuccess={handleCreated} onCancel={() => setView('list')} />
      </div>
    );
  }

  if (view === 'detail' && selected) {
    return (
      <div className="flex h-full flex-col bg-background pb-16">
        <IssueDetail
          issue={selected}
          onBack={() => setView('list')}
          onIssueUpdated={handleUpdated}
          onIssueDeleted={handleDeleted}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background pb-16">
      {/* Header */}
      <div className="relative overflow-hidden bg-primary px-6 pb-6 pt-6 mb-2">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 bottom-0 h-24 w-24 rounded-full bg-white/5" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">
              Store Issues
            </p>
            <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">
              Issue Reports
            </h1>
            <p className="mt-1 text-xs text-primary-foreground/50">
              Drafts are private. Sent issues are visible to your store.
            </p>
          </div>

          <button
            onClick={() => setView('new')}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-white/25 active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
            New Report
          </button>
        </div>

        {!loading && issuesList.length > 0 && (
          <div className="relative mt-3 flex flex-wrap gap-2">
            {[
              { label: 'Reported', value: stats.reported, color: 'bg-amber-400/25 text-amber-200' },
              { label: 'In Review', value: stats.inReview, color: 'bg-white/20 text-white' },
              { label: 'Solved', value: stats.solved, color: 'bg-violet-400/25 text-violet-200' },
              { label: 'Completed', value: stats.completed, color: 'bg-green-400/25 text-green-200' },
            ].map(({ label, value, color }) => (
              <span
                key={label}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
                  color,
                )}
              >
                <span className="text-sm font-bold">{value}</span>
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {showSuccess && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{successText}</p>
        </div>
      )}

      {/* Filter tabs */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-3">
        {FILTERS.map((filterOption) => (
          <button
            key={filterOption.value}
            onClick={() => setFilter(filterOption.value)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              filter === filterOption.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {filterOption.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-1">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibleIssues.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <AlertTriangle className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">No issues found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {filter === 'all'
                  ? 'Tap "New Report" to report a problem.'
                  : `No issues with status "${STATUS_LABELS[filter as IssueStatus]}".`}
              </p>
            </div>
          </div>
        ) : (
          visibleIssues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onClick={() => {
                setSelected(issue);
                setView('detail');
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
