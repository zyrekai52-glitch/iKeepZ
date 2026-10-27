'use strict';

// Grants or revokes the `admin` custom claim (unlocks the withdrawal-review queue in the app).
//
//   node scripts/set-admin.js <email> [grant|revoke]
//
// Credentials: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key, or
// `gcloud auth application-default login`). The project comes from GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT.
// The "Grant or revoke admin" GitHub workflow runs this for you.

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

async function main() {
  const email = process.argv[2];
  const action = process.argv[3] || 'grant';
  if (!email || !email.includes('@') || !['grant', 'revoke'].includes(action)) {
    console.error('Usage: node scripts/set-admin.js <email> [grant|revoke]');
    process.exit(2);
  }
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    console.error('Set GCLOUD_PROJECT to your Firebase project id.');
    process.exit(2);
  }

  initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims || {}) };
  if (action === 'grant') claims.admin = true;
  else delete claims.admin;

  await auth.setCustomUserClaims(user.uid, claims);
  // Revoking refresh tokens makes the new claim take effect on the next sign-in instead of up to an hour later.
  await auth.revokeRefreshTokens(user.uid);
  await getFirestore().collection('adminAudit').add({
    adminUid: 'script:set-admin',
    action: action === 'grant' ? 'admin_granted' : 'admin_revoked',
    txId: null,
    targetUid: user.uid,
    reason: null,
    details: {},
    createdAt: new Date(),
  });
  console.log(`${action === 'grant' ? 'Granted' : 'Revoked'} admin for ${email} (${user.uid}). They must sign in again.`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
