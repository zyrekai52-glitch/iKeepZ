'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

// Host and port of the emulators are discovered from the environment variables that
// `firebase emulators:exec` sets (FIRESTORE_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST).
function createEnv() {
  return initializeTestEnvironment({
    projectId: 'demo-ikeepz',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
    storage: { rules: fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8') },
  });
}

module.exports = { createEnv };
