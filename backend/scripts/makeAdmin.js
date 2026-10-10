/**
 * Give (or remove) the admin role: access to the training console in the web app.
 *   npm run make-admin -- someone@example.com
 *   npm run make-admin -- someone@example.com --remove
 * The account must already exist (register in the app first). Alternatively list e-mails in
 * ADMIN_EMAILS in backend/.env and they become admins at their next sign-in.
 */
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const logger = require('../src/config/logger');
const User = require('../src/models/User');

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const remove = process.argv.includes('--remove');
  if (!email || email.startsWith('--')) {
    throw new Error('usage: npm run make-admin -- <email> [--remove]');
  }
  await mongoose.connect(env.mongoUri);
  const user = await User.findOneAndUpdate(
    { email },
    { role: remove ? 'parent' : 'admin' },
    { new: true },
  );
  if (!user) throw new Error(`no account with e-mail ${email}: register in the app first`);
  logger.info({ email, role: user.role }, remove ? 'admin role removed' : 'admin role granted');
  logger.info('sign out and in again in the web app to see the Admin section');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.fatal({ err: err.message }, 'make-admin failed');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
