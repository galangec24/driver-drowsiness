import { useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  myFeedback,
  sendFeedback,
  type Feedback,
  type FeedbackCategory,
} from '../api/feedback';
import { API_URL, errorMessage } from '../api/client';
import { addFiles, ACCEPT, canCaptureScreen, captureScreen, formatSize, type PendingFile } from '../lib/attachments';
import { timeAgo } from '../lib/format';
import { GlassCard } from '../components/ui/GlassCard';
import { DepthButton } from '../components/ui/DepthButton';
import { Icon } from '../components/ui/Icon';
import { useToast } from '../components/ui/Toast';

const CATEGORIES: FeedbackCategory[] = ['bug', 'idea', 'question', 'other'];

export const fileUrl = (url: string) => (url.startsWith('/') ? `${API_URL}${url}` : url);

const STATUS_CLS = {
  new: 'bg-white/10 text-ink-muted',
  in_progress: 'bg-accent-primary/30 text-indigo-100',
  resolved: 'bg-emerald-500/20 text-emerald-200',
} as const;

function MyFeedbackItem({ f }: { f: Feedback }) {
  return (
    <li className="rounded-xl border border-white/10 bg-black/20 p-4" data-testid="my-feedback">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white">{CATEGORY_LABEL[f.category]}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[f.status]}`}>
          {STATUS_LABEL[f.status]}
        </span>
        <span className="ml-auto text-xs text-ink-muted">{timeAgo(f.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{f.message}</p>
      {f.attachments.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          {f.attachments.length} attachment{f.attachments.length === 1 ? '' : 's'}
        </p>
      )}
      {f.adminReply && (
        <div className="mt-3 rounded-lg border border-accent-glow/30 bg-accent-primary/10 p-3 text-sm text-indigo-50">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent-glow">Reply from the team</p>
          <p className="whitespace-pre-wrap">{f.adminReply}</p>
        </div>
      )}
    </li>
  );
}

/** Send feedback (with screenshots / files) and read the team's replies. */
export function FeedbackPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [problem, setProblem] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mine = useQuery({ queryKey: ['feedback', 'mine'], queryFn: myFeedback });

  const send = useMutation({
    mutationFn: () =>
      sendFeedback({
        category,
        message: message.trim(),
        attachments: files.map((f) => ({ name: f.name, data: f.data })),
        page: document.referrer ? new URL(document.referrer, window.location.href).pathname : undefined,
        platform: window.guardianDesktop ? 'windows' : 'web',
        appVersion: __APP_VERSION__,
      }),
    onSuccess: () => {
      setMessage('');
      setFiles([]);
      setProblem('');
      void qc.invalidateQueries({ queryKey: ['feedback', 'mine'] });
      toast.show({
        title: 'Thank you!',
        body: 'Your feedback was sent. You will see our reply here.',
        tone: 'success',
      });
    },
  });

  async function add(list: File[]) {
    const r = await addFiles(files, list);
    setFiles(r.list);
    setProblem(r.problem ?? '');
  }

  async function onCapture() {
    try {
      const shot = await captureScreen();
      if (files.length >= 4) {
        setProblem('You can attach up to 4 files.');
        return;
      }
      setFiles((f) => [...f, shot]);
    } catch {
      // the user cancelled the screen picker
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (message.trim().length < 3) {
      setProblem('Please describe your feedback in a few words.');
      return;
    }
    send.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="page-title">Feedback</h1>
        <p className="text-sm text-ink-muted">
          Tell us what went wrong, what you would like, or ask a question. Screenshots help us understand.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <GlassCard interactive={false}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="feedback-form">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type of feedback">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={category === c}
                  onClick={() => setCategory(c)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                    category === c
                      ? 'border-accent-glow/60 bg-accent-primary/30 text-white'
                      : 'border-white/10 text-ink-muted hover:text-white'
                  }`}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="label">Your message</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onPaste={(e: ClipboardEvent) => {
                  const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
                  if (imgs.length) {
                    e.preventDefault();
                    void add(imgs);
                  }
                }}
                rows={6}
                maxLength={4000}
                placeholder={
                  category === 'bug'
                    ? 'What happened? What did you expect? (You can paste a screenshot here.)'
                    : 'Write your message…'
                }
                className="rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white shadow-inner outline-none focus:border-accent-glow/70"
              />
            </label>

            <div
              onDragOver={(e: DragEvent) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                setDragging(false);
                void add(Array.from(e.dataTransfer.files));
              }}
              className={`rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors ${
                dragging ? 'border-accent-glow bg-accent-primary/10' : 'border-white/10 text-ink-muted'
              }`}
            >
              <p>Drop screenshots or files here (images, PDF, text · up to 4 files, 5 MB each)</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <DepthButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  icon={<Icon name="upload" size={16} />}
                  onClick={() => fileInput.current?.click()}
                >
                  Attach files
                </DepthButton>
                {canCaptureScreen() && (
                  <DepthButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    icon={<Icon name="image" size={16} />}
                    onClick={() => void onCapture()}
                  >
                    Capture screen
                  </DepthButton>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                aria-label="Attach files"
                onChange={(e) => {
                  void add(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </div>

            {files.length > 0 && (
              <ul className="flex flex-col gap-2" data-testid="pending-files">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg bg-black/25 p-2 text-sm">
                    {f.type.startsWith('image/') ? (
                      <img src={f.data} alt="" className="h-10 w-14 rounded object-cover" />
                    ) : (
                      <span className="flex h-10 w-14 items-center justify-center rounded bg-white/10 text-xs text-ink-muted">
                        FILE
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-white">{f.name}</span>
                    <span className="text-xs text-ink-muted">{formatSize(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                      aria-label={`Remove ${f.name}`}
                      className="rounded p-1 text-ink-muted hover:bg-white/10 hover:text-white"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {(problem || send.isError) && (
              <p role="alert" className="text-sm text-red-200">
                {problem || errorMessage(send.error, 'Could not send')}
              </p>
            )}
            <DepthButton type="submit" size="lg" block loading={send.isPending}>
              Send feedback
            </DepthButton>
          </form>
        </GlassCard>

        <section>
          <h2 className="mb-3 text-lg font-bold text-white">Your feedback</h2>
          {mine.data && mine.data.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {mine.data.map((f) => (
                <MyFeedbackItem key={f.id} f={f} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Nothing sent yet. Replies from the team will appear here.</p>
          )}
        </section>
      </div>
    </div>
  );
}
