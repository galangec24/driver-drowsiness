import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { CallButton } from './CallButton';

type Handler = (payload: never) => void;
const handlers: Record<string, Handler> = {};
const emitted: { event: string; payload: unknown }[] = [];
let startReply: Record<string, unknown> = { ok: true, callId: 'c1', iceServers: [] };

const socket = {
  on: (ev: string, fn: Handler) => {
    handlers[ev] = fn;
  },
  off: (ev: string) => {
    delete handlers[ev];
  },
  emit: (event: string, payload: unknown, ack?: (r: unknown) => void) => {
    emitted.push({ event, payload });
    if (event === 'call:start' && ack) ack(startReply);
  },
};
vi.mock('../../hooks/useRealtime', () => ({
  useRealtime: () => ({ socket, connected: true, live: {}, pulsing: new Set() }),
}));

class FakePC {
  static last: FakePC;
  localDescription: { type: string; sdp: string } | null = null;
  remote: unknown = null;
  iceGatheringState = 'complete';
  connectionState = 'new';
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((e: unknown) => void) | null = null;
  constructor() {
    FakePC.last = this;
  }
  addTrack() {}
  addEventListener() {}
  removeEventListener() {}
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 parent' };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: unknown) {
    this.remote = d;
  }
  close() {}
}

beforeEach(() => {
  emitted.length = 0;
  startReply = { ok: true, callId: 'c1', iceServers: [] };
  vi.stubGlobal('RTCPeerConnection', FakePC);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [], getAudioTracks: () => [] }) },
  });
});

describe('calling the car', () => {
  test('ring -> car answers -> offer sent -> answer applied -> connected -> hang up', async () => {
    render(<CallButton driverId="d1" driverName="Galang Cruz" />);
    await userEvent.click(screen.getByTestId('call-button'));
    expect(await screen.findByTestId('call-status')).toHaveTextContent("Calling Galang's car");
    expect(emitted[0]).toEqual({ event: 'call:start', payload: { driverId: 'd1' } });

    await act(async () => handlers['call:accepted']?.({ callId: 'c1' } as never));
    await waitFor(() =>
      expect(emitted).toContainEqual({
        event: 'call:signal',
        payload: { callId: 'c1', data: { type: 'offer', sdp: 'v=0 parent' } },
      }),
    );
    await act(async () =>
      handlers['call:signal']?.({ callId: 'c1', data: { type: 'answer', sdp: 'v=0 car' } } as never),
    );
    expect(FakePC.last.remote).toEqual({ type: 'answer', sdp: 'v=0 car' });

    act(() => {
      FakePC.last.connectionState = 'connected';
      FakePC.last.onconnectionstatechange?.();
    });
    expect(screen.getByTestId('call-status')).toHaveTextContent('Connected');
    await userEvent.click(screen.getByTestId('hang-up'));
    expect(emitted).toContainEqual({ event: 'call:end', payload: { callId: 'c1' } });
    expect(screen.getByTestId('call-status')).toHaveTextContent('Call ended');
  });

  test('a car that is not online gets a clear message', async () => {
    startReply = { ok: false, error: 'offline' };
    render(<CallButton driverId="d1" driverName="Galang" />);
    await userEvent.click(screen.getByTestId('call-button'));
    expect(await screen.findByTestId('call-status')).toHaveTextContent('The car is not connected right now');
  });
});
