import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AlertCard } from './AlertCard';
import { makeAlert } from '../../test/utils';

describe('AlertCard false-alarm feedback', () => {
  test('False alarm button reports the alert id', async () => {
    const onFalseAlarm = vi.fn();
    render(<AlertCard alert={makeAlert({ id: 'fa1' })} onAcknowledge={() => {}} onFalseAlarm={onFalseAlarm} />);
    await userEvent.click(screen.getByRole('button', { name: /false alarm/i }));
    expect(onFalseAlarm).toHaveBeenCalledWith('fa1');
  });

  test('acknowledged alerts can still be reported, and show the label once reported', async () => {
    const onFeedback = vi.fn();
    const acked = makeAlert({ id: 'fa2', acknowledged: true, acknowledgedBy: 'web', falseAlarm: null });
    const { rerender } = render(<AlertCard alert={acked} onFeedback={onFeedback} />);
    await userEvent.click(screen.getByRole('button', { name: /report false alarm/i }));
    expect(onFeedback).toHaveBeenCalledWith('fa2', true);

    rerender(<AlertCard alert={{ ...acked, falseAlarm: true }} onFeedback={onFeedback} />);
    expect(screen.getByTestId('fa-label')).toHaveTextContent('reported as false alarm');
    expect(screen.queryByRole('button', { name: /report false alarm/i })).not.toBeInTheDocument();
  });
});

describe('AlertCard', () => {
  test('drowsy alert shows details with red glow, pulse and leading edge', () => {
    render(<AlertCard alert={makeAlert()} onAcknowledge={() => {}} />);
    const card = screen.getByTestId('alert-card');
    expect(card).toHaveAttribute('data-severity', 'danger');
    expect(card).toHaveClass('shadow-glow-danger', 'edge-danger', 'border-l-accent-danger');
    expect(screen.getByTestId('danger-glow')).toHaveClass('animate-pulse-slow');
    expect(screen.getByText('Drowsy')).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('83%')).toBeInTheDocument();
    expect(screen.getByText('0.081')).toBeInTheDocument();
    expect(screen.getByText('48 bpm')).toBeInTheDocument();
  });

  test('warning alert uses amber styling without the danger pulse', () => {
    render(<AlertCard alert={makeAlert({ type: 'warning' })} />);
    const card = screen.getByTestId('alert-card');
    expect(card).toHaveAttribute('data-severity', 'warn');
    expect(screen.queryByTestId('danger-glow')).not.toBeInTheDocument();
    expect(screen.getByText('Fatigue warning')).toBeInTheDocument();
  });

  test('acknowledge button calls back with the alert id', async () => {
    const onAck = vi.fn();
    render(<AlertCard alert={makeAlert({ id: 'xyz' })} onAcknowledge={onAck} />);
    await userEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    expect(onAck).toHaveBeenCalledWith('xyz');
  });

  test('acknowledged alert shows who acknowledged it and no button', () => {
    render(
      <AlertCard
        alert={makeAlert({ acknowledged: true, acknowledgedBy: 'apk', acknowledgedAt: new Date().toISOString() })}
        onAcknowledge={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('ack-label')).toHaveTextContent('Acknowledged via Android app');
    expect(screen.queryByTestId('danger-glow')).not.toBeInTheDocument();
  });
});

describe('AlertCard snapshot and location', () => {
  const where = { lat: 14.5547, lng: 121.0244, heading: 90, speed: 58, at: new Date().toISOString() };

  test('no snapshot or location → no detail button', () => {
    render(<AlertCard alert={makeAlert()} />);
    expect(screen.queryByTestId('alert-detail-button')).not.toBeInTheDocument();
  });

  test('opens the detail view with the driver snapshot, Google map and directions', async () => {
    render(<AlertCard alert={makeAlert({ snapshotUrl: 'https://cdn.example/snap.jpg', location: where })} />);
    expect(screen.getByTestId('alert-snapshot').querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example/snap.jpg',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Snapshot & map' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Driver at the moment of the alert');
    expect(screen.getByAltText(/when the alert fired/)).toHaveAttribute('src', 'https://cdn.example/snap.jpg');
    expect(screen.getByTitle('Alert location on Google Maps')).toHaveAttribute(
      'src',
      expect.stringContaining('q=14.554700,121.024400'),
    );
    expect(screen.getByRole('link', { name: /directions/i })).toHaveAttribute(
      'href',
      expect.stringContaining('destination=14.554700,121.024400'),
    );
    expect(dialog).toHaveTextContent('Heading E');
    expect(dialog).toHaveTextContent('58 km/h');

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('location without a snapshot shows the map and a placeholder', async () => {
    render(<AlertCard alert={makeAlert({ location: where })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByText('No camera snapshot for this alert.')).toBeInTheDocument();
  });
});

describe('AlertCard delivered late', () => {
  test('an alert recorded offline shows when it happened and that it was sent late', () => {
    const happened = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const alert = makeAlert({
      createdAt: new Date().toISOString(),
      delayedS: 1200,
      sensorSnapshot: { ear: 0.08, perclos: 0.8, heartRate: 50, timestamp: happened },
    });
    render(<AlertCard alert={alert} onAcknowledge={() => {}} />);
    expect(screen.getByTestId('alert-delayed')).toHaveTextContent('Sent 20 min late: the car was offline');
    expect(screen.getByText(/20 min/)).toBeInTheDocument();
  });
});
