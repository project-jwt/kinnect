// Invitations a TRUSTED CONTACT sends — kept separate from contacts-adapters,
// which is the primary's own list, mirroring the router split on the backend.

import { handleFetch } from './fetch-helpers';

// POST /api/invitations/primary { email } -> { message }
// Contact-only: a primary's token gets 403. 502 when the email provider is
// down. Nothing is stored server-side, so there is no invitation to list,
// resend, or cancel afterwards.
export const invitePrimary = (email) =>
  handleFetch('/api/invitations/primary', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
