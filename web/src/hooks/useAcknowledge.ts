import { useMutation, useQueryClient } from '@tanstack/react-query';
import { acknowledgeAlert, sendFeedback } from '../api/alerts';
import { errorMessage } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { applyAcknowledged, applyFeedback } from './useRealtime';

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
        toast.show({ title: 'Marked as false alarm', body: 'Thanks — this helps reduce false alerts.', tone: 'success' });
      }
    },
    onError: (err) => toast.show({ title: 'Could not acknowledge', body: errorMessage(err), tone: 'danger' }),
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
