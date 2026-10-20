import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUICK_REMINDERS, listMessages, sendMessage, type DriverMessage } from '../../api/messages';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../ui/GlassCard';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { timeAgo } from '../../lib/format';

const STATUS: Record<DriverMessage['status'], { label: string; cls: string }> = {
  delivered: { label: 'Read aloud in the car', cls: 'text-emerald-300' },
  pending: { label: 'Waiting for the car to be online', cls: 'text-amber-200' },
  expired: { label: 'Not delivered (the car was offline)', cls: 'text-ink-muted' },
};

/** Send a message or a quick reminder; the in-car voice reads it to the driver. */
export function MessagePanel({ driverId, driverName }: { driverId: string; driverName: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const first = driverName.split(' ')[0];
  const messages = useQuery({ queryKey: ['messages', driverId], queryFn: () => listMessages(driverId) });
  const send = useMutation({
    mutationFn: (body: { text: string; kind: 'message' | 'reminder' }) => sendMessage(driverId, body),
    onSuccess: ({ carOnline }) => {
      setText('');
      void qc.invalidateQueries({ queryKey: ['messages', driverId] });
      toast.show({
        title: carOnline ? `Sent to ${first}'s car` : 'Saved for later',
        body: carOnline
          ? 'The voice assistant reads it to the driver now.'
          : 'The car is offline: it will be read as soon as the car is back online.',
        tone: carOnline ? 'success' : 'info',
      });
    },
    onError: (e) => toast.show({ title: 'Could not send', body: errorMessage(e), tone: 'danger' }),
  });

  return (
    <GlassCard interactive={false} className="flex flex-col gap-3" data-testid="message-panel">
      <h2 className="flex items-center gap-2 text-lg font-bold text-white">
        <Icon name="mail" size={20} className="text-accent-glow" /> Message {first}
      </h2>
      <p className="text-sm text-ink-muted">
        The in-car voice assistant reads it aloud, so {first} never has to look at a phone while driving.
      </p>
      <div className="flex flex-wrap gap-2">
        {QUICK_REMINDERS.map((r) => (
          <button
            key={r}
            type="button"
            disabled={send.isPending}
            onClick={() => send.mutate({ text: r, kind: 'reminder' })}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
          >
            {r}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send.mutate({ text: text.trim(), kind: 'message' });
        }}
      >
        <input
          className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none focus:border-accent-glow/70"
          placeholder={`Write a short message to ${first}`}
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Message"
        />
        <DepthButton type="submit" loading={send.isPending} disabled={!text.trim()}>
          Send
        </DepthButton>
      </form>
      {(messages.data ?? []).length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="message-history">
          {(messages.data ?? []).slice(0, 6).map((m) => (
            <li key={m.id} className="glass-inset flex flex-col gap-0.5 p-2.5 text-sm">
              <span className="text-white">{m.text}</span>
              <span className="text-[11px] text-ink-muted">
                {timeAgo(m.createdAt)} · <span className={STATUS[m.status].cls}>{STATUS[m.status].label}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
