import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './store/auth';
import { ToastProvider } from './components/ui/Toast';
import { router } from './router';
import { ServerWake } from './components/ui/ServerWake';

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
