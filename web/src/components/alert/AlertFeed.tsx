import { AnimatePresence } from 'framer-motion';
import type { Alert } from '../../api/types';
import { AlertCard } from './AlertCard';
import { useAcknowledge, useFeedback } from '../../hooks/useAcknowledge';
import { Icon } from '../ui/Icon';

export function AlertFeed({
  alerts,
  compact,
  emptyText = 'No alerts. Everyone is driving safely.',
}: {
  alerts: Alert[];
  compact?: boolean;
  emptyText?: string;
}) {
  const ack = useAcknowledge();
  const feedback = useFeedback();

  if (!alerts.length) {
    return (
      <div className="glass-inset flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-ink-muted">
        <Icon name="shield" size={32} className="text-accent-ok/80" />
        <p className="text-sm">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="alert-feed">
      <AnimatePresence initial={false}>
        {alerts.map((a) => (
          <AlertCard
            key={a.id}
            alert={a}
            compact={compact}
            onAcknowledge={(id) => ack.mutate({ id })}
            onFalseAlarm={(id) => ack.mutate({ id, falseAlarm: true })}
            onFeedback={(id, falseAlarm) => feedback.mutate({ id, falseAlarm })}
            acknowledging={ack.isPending && ack.variables?.id === a.id}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
