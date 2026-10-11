/**
 * "Continue with Google": the website / app gets a Google ID token (a JWT signed by Google) and
 * sends it here. We check Google's signature, that it was issued for OUR client id, and that
 * Google has verified the e-mail. No Google password or access token ever reaches this server.
 */
const { OAuth2Client } = require('google-auth-library');
const { env } = require('../config/env');

const client = new OAuth2Client();
let verifyImpl = null; // test hook

/** @returns {Promise<{sub:string, email:string, emailVerified:boolean, name:string}>} */
async function verifyGoogleIdToken(idToken) {
  if (verifyImpl) return verifyImpl(idToken);
  const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientIds });
  const p = ticket.getPayload() || {};
  return {
    sub: p.sub,
    email: String(p.email || '').toLowerCase(),
    emailVerified: p.email_verified === true,
    name: p.name || p.given_name || String(p.email || '').split('@')[0],
  };
}

function _setVerifier(fn) {
  verifyImpl = fn;
}

module.exports = { verifyGoogleIdToken, _setVerifier };
