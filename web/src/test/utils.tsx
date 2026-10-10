import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../store/auth';
import { ToastProvider } from '../components/ui/Toast';
import type { Alert } from '../api/types';

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <ToastProvider>
            <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    );
  }
  return { qc, ...render(ui, { wrapper: Wrapper }) };
}

export function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    driverId: 'd1',
    parentId: 'p1',
    type: 'drowsy',
    confidence: 0.83,
    sensorSnapshot: { ear: 0.081, perclos: 0.6, heartRate: 48 },
    acknowledged: false,
    createdAt: new Date().toISOString(),
    driverName: 'Alex',
    ...overrides,
  };
}
