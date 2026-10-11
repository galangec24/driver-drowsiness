/// The parent website. The app opens its /app-login page in the browser for Google sign-in
/// (Google does not allow signing in inside an app's embedded web view).
const webAppUrl = String.fromEnvironment(
  'WEB_URL',
  defaultValue: 'https://guardian-drive-ph.web.app',
);
