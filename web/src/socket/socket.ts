import { io, type Socket } from 'socket.io-client';
import { API_URL } from '../api/client';
import type { Alert, AckSource, DriverLiveStatus } from '../api/types';
import type { TrainingJob } from '../api/admin';
import type { Feedback } from '../api/feedback';

export interface ServerToClientEvents {
  'alert:new': (alert: Alert) => void;
  'alert:acknowledged': (payload: { alertId: string; acknowledgedBy: AckSource; falseAlarm?: boolean }) => void;
  'alert:feedback': (payload: { alertId: string; falseAlarm: boolean }) => void;
  'alert:updated': (payload: { alertId: string; snapshotUrl?: string }) => void;
  'alert:read': (payload: { alertIds: string[]; read: boolean }) => void;
  'alert:removed': (payload: { alertIds: string[] }) => void;
  'driver:status': (status: DriverLiveStatus) => void;
  /** Admins only: training worker job status and log output. */
  'training:job': (job: TrainingJob) => void;
  'training:log': (payload: { jobId: string; text: string }) => void;
  /** Admins: a user sent feedback / it was updated. The sender: the team replied or changed its status. */
  'feedback:new': (feedback: Feedback) => void;
  'feedback:updated': (feedback: Feedback) => void;
}

export interface ClientToServerEvents {
  'subscribe:driver': (payload: { driverId: string }, ack?: (res: { ok: boolean; error?: string }) => void) => void;
}

export type GuardianSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * One Socket.io connection per logged-in parent. JWT goes in the handshake.
 * Reconnects with exponential backoff capped at 30 s (web/CLAUDE.md § 8).
 */
export function createSocket(token: string): GuardianSocket {
  return io(API_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
    timeout: 10000,
  });
}
