import { render, screen } from '@testing-library/react';
import { GlassCard } from './GlassCard';

describe('GlassCard', () => {
  test('renders children on a glass surface with depth', () => {
    render(<GlassCard>Hello driver</GlassCard>);
    const card = screen.getByTestId('glass-card');
    expect(card).toHaveTextContent('Hello driver');
    // .glass = bg-glass-light + backdrop-blur-glass + border-glass-border + shadow-depth-2 + rounded-2xl
    expect(card).toHaveClass('glass', 'glass-hover', 'p-5');
  });

  test('danger variant glows and pulses', () => {
    render(<GlassCard danger>Drowsy</GlassCard>);
    expect(screen.getByTestId('glass-card')).toHaveClass('shadow-glow-danger');
    // The glow layer pulses, not the content (text stays fully readable).
    expect(screen.getByTestId('danger-glow')).toHaveClass('animate-pulse-slow');
    expect(screen.getByTestId('glass-card')).not.toHaveClass('animate-pulse-slow');
  });

  test('non-interactive and unpadded variants', () => {
    render(
      <GlassCard interactive={false} padded={false} className="custom">
        Static
      </GlassCard>,
    );
    const card = screen.getByTestId('glass-card');
    expect(card).not.toHaveClass('glass-hover');
    expect(card).not.toHaveClass('p-5');
    expect(card).toHaveClass('custom');
  });
});
