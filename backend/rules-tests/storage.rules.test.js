'use strict';

const { test, before, after, beforeEach } = require('node:test');
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { ref, uploadBytes, getBytes, deleteObject } = require('firebase/storage');
const { createEnv } = require('./env');

let env;
before(async () => {
  env = await createEnv();
});
after(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearStorage();
});

const as = (uid) => env.authenticatedContext(uid).storage();
const anonymous = () => env.unauthenticatedContext().storage();
const bytes = (size) => new Uint8Array(size).fill(7);
const AVATAR = 'users/alice/avatar/avatar.jpg';

test('the owner can upload, read and delete their avatar', async () => {
  const storage = as('alice');
  await assertSucceeds(uploadBytes(ref(storage, AVATAR), bytes(1024), { contentType: 'image/jpeg' }));
  await assertSucceeds(getBytes(ref(storage, AVATAR)));
  await assertSucceeds(uploadBytes(ref(storage, 'users/alice/avatar/avatar.png'), bytes(1024), { contentType: 'image/png' }));
  await assertSucceeds(uploadBytes(ref(storage, 'users/alice/avatar/avatar.webp'), bytes(1024), { contentType: 'image/webp' }));
  await assertSucceeds(deleteObject(ref(storage, AVATAR)));
});

test('nobody else can read, replace or delete it', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), AVATAR), bytes(1024), { contentType: 'image/jpeg' });
  });
  for (const storage of [as('bob'), anonymous()]) {
    await assertFails(getBytes(ref(storage, AVATAR)));
    await assertFails(uploadBytes(ref(storage, AVATAR), bytes(1024), { contentType: 'image/jpeg' }));
    await assertFails(deleteObject(ref(storage, AVATAR)));
  }
});

test('only small images with the expected name are accepted', async () => {
  const storage = as('alice');
  const upload = (path, size, contentType) => uploadBytes(ref(storage, path), bytes(size), { contentType });
  await assertSucceeds(upload(AVATAR, 2 * 1024 * 1024 - 1, 'image/jpeg'));
  await assertFails(upload(AVATAR, 2 * 1024 * 1024, 'image/jpeg'));
  await assertFails(upload(AVATAR, 5 * 1024 * 1024, 'image/jpeg'));
  await assertFails(upload(AVATAR, 0, 'image/jpeg'));
  for (const contentType of ['image/gif', 'image/svg+xml', 'text/html', 'application/pdf', 'application/octet-stream']) {
    await assertFails(upload(AVATAR, 1024, contentType));
  }
  for (const path of ['users/alice/avatar/evil.jpg', 'users/alice/avatar/avatar.exe', 'users/alice/avatar/avatar.jpg.html', 'users/alice/avatar/AVATAR.jpg']) {
    await assertFails(upload(path, 1024, 'image/jpeg'));
  }
});

test('everything outside the avatar folder is closed', async () => {
  const storage = as('alice');
  for (const path of ['users/alice/other.jpg', 'users/alice/avatar/sub/avatar.jpg', 'users/bob/avatar/avatar.jpg', 'avatar.jpg', 'public/x.jpg', 'receipts/alice/r.jpg']) {
    await assertFails(uploadBytes(ref(storage, path), bytes(1024), { contentType: 'image/jpeg' }));
    await assertFails(getBytes(ref(storage, path)));
  }
});
