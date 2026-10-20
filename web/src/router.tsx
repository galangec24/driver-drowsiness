import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { RealtimeProvider } from './hooks/useRealtime';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DriversPage } from './pages/DriversPage';
import { RegisterDriverPage } from './pages/RegisterDriverPage';
import { DriverDetailPage } from './pages/DriverDetailPage';
import { AlertsPage } from './pages/AlertsPage';
import { SettingsPage } from './pages/SettingsPage';
import { DownloadPage } from './pages/DownloadPage';
import { AppLoginPage } from './pages/AppLoginPage';
import { EmbedMapPage } from './pages/EmbedMapPage';
import { AdminPage } from './pages/admin/AdminPage';
import { FeedbackPage } from './pages/FeedbackPage';
import { SurveysPage } from './pages/SurveysPage';

/** "/" is the parent dashboard; admins have their own console. */
function HomePage() {
  const { user } = useAuth();
  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  return <DashboardPage />;
}

function RequireAuth() {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // One Socket.io connection per logged-in session.
  return (
    <RealtimeProvider>
      <Outlet />
    </RealtimeProvider>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Public: anyone can get the app before having an account.
  { path: '/download', element: <DownloadPage /> },
  // Opened in the normal browser by the Windows/Android app for Google sign-in.
  { path: '/app-login', element: <AppLoginPage /> },
  // 3D map shown inside the Android app (coordinates only, no sign-in).
  { path: '/embed/map', element: <EmbedMapPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'drivers', element: <DriversPage /> },
          { path: 'drivers/new', element: <RegisterDriverPage /> },
          { path: 'drivers/:id', element: <DriverDetailPage /> },
          { path: 'alerts', element: <AlertsPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'feedback', element: <FeedbackPage /> },
          { path: 'surveys', element: <SurveysPage /> },
          { path: 'admin', element: <AdminPage /> },
          { path: 'admin/:tab', element: <AdminPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
