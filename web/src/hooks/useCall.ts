import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from './useRealtime';

/**
 * Voice call from the parent to the car (WebRTC audio). The server relays the set-up only; the
 * in-car device rings, then answers by itself after a few seconds (hands-free for the driver).
 * The offer / answer carry every ICE candidate (no trickle), which keeps signalling to two messages.
 */
export type CallState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'ringing'; callId: string }
  | { phase: 'connecting'; callId: string }
  | { phase: 'connected'; callId: string; since: number }
  | { phase: 'ended'; reason: string };

const REASONS: Record<string, string> = {
  offline: 'The car is not connected right now. The in-car device must be on and online.',
  busy: 'The car is already on a call.',
  not_found: 'Driver not found.',
  no_answer: 'No answer from the car.',
  declined: 'The car could not answer (no microphone?).',
  hangup: 'Call ended.',
  disconnected: 'The connection was lost.',
  mic: 'Microphone access is needed to call. Allow it in the browser and try again.',
  failed: 'The call could not be connected.',
  unsupported: 'This browser cannot make calls.',
};
export const callReason = (r: string) => REASONS[r] ?? REASONS.failed;

function waitForIce(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, timeoutMs);
  });
}

export function useCall() {
  const { socket, connected } = useRealtime();
  const [state, setState] = useState<CallState>({ phase: 'idle' });
  const [muted, setMuted] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callIdRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    callIdRef.current = null;
    setMuted(false);
  }, []);

  const finish = useCallback(
    (reason: string) => {
      cleanup();
      setState({ phase: 'ended', reason });
    },
    [cleanup],
  );

  useEffect(() => {
    if (!socket) return undefined;
    const onAccepted = async ({ callId }: { callId: string }) => {
      const pc = pcRef.current;
      if (!pc || callId !== callIdRef.current) return;
      setState({ phase: 'connecting', callId });
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);
      const desc = pc.localDescription;
      if (desc) socket.emit('call:signal', { callId, data: { type: desc.type, sdp: desc.sdp } });
    };
    const onSignal = async ({ callId, data }: { callId: string; data: { type: RTCSdpType; sdp: string } }) => {
      const pc = pcRef.current;
      if (!pc || callId !== callIdRef.current || data.type !== 'answer') return;
      await pc.setRemoteDescription(data);
    };
    const onEnded = ({ callId, reason }: { callId: string; reason: string }) => {
      if (callId === callIdRef.current) finish(reason);
    };
    socket.on('call:accepted', onAccepted);
    socket.on('call:signal', onSignal);
    socket.on('call:ended', onEnded);
    return () => {
      socket.off('call:accepted', onAccepted);
      socket.off('call:signal', onSignal);
      socket.off('call:ended', onEnded);
    };
  }, [socket, finish]);

  // Leaving the page hangs up.
  useEffect(
    () => () => {
      if (callIdRef.current && socket) socket.emit('call:end', { callId: callIdRef.current });
      cleanup();
    },
    [socket, cleanup],
  );

  const start = useCallback(
    async (driverId: string) => {
      if (!socket) return setState({ phase: 'ended', reason: 'failed' });
      if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        return setState({ phase: 'ended', reason: 'unsupported' });
      }
      setState({ phase: 'starting' });
      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        return setState({ phase: 'ended', reason: 'mic' });
      }
      micRef.current = mic;
      const res = await new Promise<{ ok: boolean; error?: string; callId?: string; iceServers?: RTCIceServer[] }>(
        (resolve) => socket.emit('call:start', { driverId }, resolve),
      );
      if (!res.ok || !res.callId) return finish(res.error ?? 'failed');
      const pc = new RTCPeerConnection({ iceServers: res.iceServers ?? [] });
      pcRef.current = pc;
      callIdRef.current = res.callId;
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));
      pc.ontrack = (e) => {
        if (!audioRef.current) audioRef.current = new Audio();
        audioRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
        void audioRef.current.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        const id = callIdRef.current;
        if (!id) return;
        if (pc.connectionState === 'connected') setState({ phase: 'connected', callId: id, since: Date.now() });
        if (pc.connectionState === 'failed') {
          socket.emit('call:end', { callId: id });
          finish('failed');
        }
      };
      setState({ phase: 'ringing', callId: res.callId });
      return undefined;
    },
    [socket, finish],
  );

  const hangUp = useCallback(() => {
    if (callIdRef.current && socket) socket.emit('call:end', { callId: callIdRef.current });
    finish('hangup');
  }, [socket, finish]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, [muted]);

  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, muted, start, hangUp, toggleMute, reset, ready: Boolean(socket && connected) };
}
