import { useMutation, useQueryClient } from '@tanstack/react-query';
import { acknowledgeAlert, markAlertRead, markAllAlertsRead, removeAlerts, sendFeedback } from '../api/alerts';
import { errorMessage } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { applyAcknowledged, applyFeedback, applyRead, applyRemoved } from './useRealtime';

/** Acknowledge (optionally as a false alarm); the server is the arbiter (first ack wins). */
export function useAcknowledge() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: acknowledgeAlert,
    onSuccess: ({ alert, alreadyAcknowledged }, { falseAlarm }) => {
      applyAcknowledged(qc, alert.id, alert.acknowledgedBy, alert.falseAlarm);
      if (alreadyAcknowledged) {
        toast.show({ title: 'Already acknowledged', body: 'Another device got there first.', tone: 'info' });
      } else if (falseAlarm) {
        toast.show({
          title: 'Marked as false alarm',
          body: 'Thanks — this helps reduce false alerts.',
          tone: 'success',
        });
      }
    },
    onError: (err) => {
      toast.show({ title: 'Could not acknowledge', body: errorMessage(err), tone: 'danger' });
      // e.g. it became a previous-day alert in the meantime: refresh to show it as unacknowledged
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

/** Remove one alert, several, or every expired one. */
export function useRemoveAlerts() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: removeAlerts,
    onSuccess: (ids) => {
      applyRemoved(qc, ids);
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      toast.show({
        title: ids.length === 1 ? 'Alert removed' : `${ids.length} alerts removed`,
        tone: 'success',
      });
    },
    onError: (err) => toast.show({ title: 'Could not remove', body: errorMessage(err), tone: 'danger' }),
  });
}

/** Notifications: mark one read / unread, or all read. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAlertRead,
    onSuccess: (alert) => applyRead(qc, [alert.id], Boolean(alert.read)),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAllAlertsRead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

/** Label an already-acknowledged alert. */
export function useFeedback() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: sendFeedback,
    onSuccess: (alert) => {
      applyFeedback(qc, alert.id, Boolean(alert.falseAlarm));
      toast.show({ title: 'Feedback saved', body: 'Thanks — this helps reduce false alerts.', tone: 'success' });
    },
    onError: (err) => toast.show({ title: 'Could not save feedback', body: errorMessage(err), tone: 'danger' }),
  });
}
