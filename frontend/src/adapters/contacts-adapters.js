// Adapters for spec §Trusted Contacts (primary only). All require a valid
// JWT (handleFetch attaches it automatically); the backend rejects contact
// accounts with 403.

import { handleFetch } from './fetch-helpers';

// [{ status, linkId, contactId, fullName, email, nickname, relationship,
//    inviteId, invitedAt }]
// status "active" = a real link (linkId/contactId/fullName set); status
// "invited" = someone invited who hasn't registered (inviteId/invitedAt set,
// fullName null). Active rows come first.
export const listContacts = () => handleFetch('/api/contacts');

// Adds a contact by email. The person does NOT need an account: one with a
// Contact account is linked right away (status "active"), and an email with no
// account is INVITED (status "invited") — they get a signup link and hold a
// place on the list until they join.
// 404 now means only "that email belongs to a different kind of account";
// 409 when they're already on the list or already invited; 429 at either
// invite cap; 502 if the invitation email couldn't be sent (nothing recorded).
export const addContact = ({ contactEmail, nickname, relationship }) =>
  handleFetch('/api/contacts', {
    method: 'POST',
    body: JSON.stringify({ contactEmail, nickname, relationship }),
  });

// Updates nickname / relationship. Only the keys present in `fields` are
// touched — the backend tells "omitted" apart from "set to null".
export const updateContact = (linkId, fields) =>
  handleFetch(`/api/contacts/${linkId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });

export const deleteContact = (linkId) =>
  handleFetch(`/api/contacts/${linkId}`, { method: 'DELETE' });

// ── pending invitations ──────────────────────────────────────────────────────
// Keyed by inviteId, NOT linkId — an invited person has no link yet, and the
// two are independent id sequences.

export const updateInvite = (inviteId, fields) =>
  handleFetch(`/api/contacts/invites/${inviteId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });

// 429 when the hourly cooldown hasn't elapsed.
export const resendInvite = (inviteId) =>
  handleFetch(`/api/contacts/invites/${inviteId}/resend`, { method: 'POST' });

export const cancelInvite = (inviteId) =>
  handleFetch(`/api/contacts/invites/${inviteId}`, { method: 'DELETE' });
