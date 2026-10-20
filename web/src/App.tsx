import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './store/auth';
import { ToastProvider } from './components/ui/Toast';
import { router } from './router';
import { ServerWake } from './components/ui/ServerWake';
import { useEffect, useState } from 'react';
import { MaintenancePage } from './pages/StatusPages';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15000,
      retry: (count, err) => {
        const status = (err as { response?: { status?: number } }).response?.status;
        return status !== undefined && status < 500 ? false : count < 2;
      },
      refetchOnWindowFocus: true,
    },
  },
});

export function App() {
  const [maintenance, setMaintenance] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMaintenance((e as CustomEvent<string>).detail || '');
    window.addEventListener('gd:maintenance', on);
    return () => window.removeEventListener('gd:maintenance', on);
  }, []);
  if (maintenance !== null) {
    return <MaintenancePage message={maintenance} onBack={() => window.location.reload()} />;
  }
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
          <ServerWake />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
