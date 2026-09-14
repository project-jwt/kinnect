// Tests for displayName — the nickname/name/email fallback chain.
//
// The email fallback exists because an INVITED contact has no fullName: they
// haven't registered, so nobody has typed their name. Without it, an invite
// with no nickname renders as an empty row.
//
// Run: npm test (node --test, no framework needed)

import test from 'node:test';
import assert from 'node:assert/strict';
import { displayName, isInvited, parseInviteParams, rowKey } from './utils.js';

test('prefers the nickname the primary chose', () => {
  assert.equal(
    displayName({ nickname: 'Mom', fullName: 'Eleanor P.', email: 'e@x.com' }),
    'Mom'
  );
});

test('falls back to the registered full name', () => {
  assert.equal(
    displayName({ nickname: null, fullName: 'Eleanor P.', email: 'e@x.com' }),
    'Eleanor P.'
  );
});

test('falls back to the email for an invited contact with no nickname', () => {
  assert.equal(
    displayName({ status: 'invited', nickname: null, fullName: null, email: 'e@x.com' }),
    'e@x.com'
  );
});

test('an invited contact with a nickname still shows the nickname', () => {
  assert.equal(
    displayName({ status: 'invited', nickname: 'Kid', fullName: null, email: 'e@x.com' }),
    'Kid'
  );
});

// isInvited / rowKey — shared by TrustedContactsList and ChooseAction, which
// both render the two-shape /api/contacts list.

test('isInvited tells the two row shapes apart', () => {
  assert.equal(isInvited({ status: 'invited' }), true);
  assert.equal(isInvited({ status: 'active' }), false);
});

test('rowKey namespaces the two id sequences so they cannot collide', () => {
  // A link and an invite can share a number — they come from separate
  // sequences — so the raw ids must not be used as keys directly.
  assert.notEqual(
    rowKey({ status: 'active', linkId: 7, inviteId: null }),
    rowKey({ status: 'invited', inviteId: 7, linkId: null })
  );
});

test('rowKey gives distinct keys to two invited rows', () => {
  // The bug this exists to prevent: an invited row's linkId is null, so keying
  // on linkId alone made every invite collide on the same null key.
  assert.notEqual(
    rowKey({ status: 'invited', inviteId: 1, linkId: null }),
    rowKey({ status: 'invited', inviteId: 2, linkId: null })
  );
});

// parseInviteParams — the invitation links we email land on the app root with
// query params. Extracted from App.jsx's effect specifically so it can be
// tested: there is no jsdom here, so component code cannot be.

test('returns null when the URL carries no invitation', () => {
  assert.equal(parseInviteParams(''), null);
  assert.equal(parseInviteParams('?foo=bar'), null);
});

test('returns null for an unrecognized invite kind', () => {
  // Guards against a typo'd or hand-edited link silently choosing a role.
  assert.equal(parseInviteParams('?invite=admin&email=a%40b.com'), null);
  assert.equal(parseInviteParams('?invite=&email=a%40b.com'), null);
});

test('reads a contact invitation', () => {
  const got = parseInviteParams('?invite=contact&email=a%40b.com');
  assert.equal(got.role, 'contact');
  assert.equal(got.email, 'a@b.com');
  // Only the primary-invite link carries a contact address.
  assert.equal(got.contactEmail, null);
});

test('reads a primary invitation with the contact address to add', () => {
  const got = parseInviteParams(
    '?invite=primary&email=new%40b.com&contact=chris%40example.com'
  );
  assert.equal(got.role, 'primary');
  assert.equal(got.email, 'new@b.com');
  assert.equal(got.contactEmail, 'chris@example.com');
});

test('does not double-decode an address containing a plus', () => {
  // The backend encodes with quote(), so '+' arrives as %2B. URLSearchParams
  // already decodes once; decoding again would turn it into a space.
  const got = parseInviteParams('?invite=primary&email=new%2Buser%40b.com');
  assert.equal(got.email, 'new+user@b.com');
});

test('tolerates a link with no email at all', () => {
  const got = parseInviteParams('?invite=contact');
  assert.equal(got.role, 'contact');
  assert.equal(got.email, '');
});
