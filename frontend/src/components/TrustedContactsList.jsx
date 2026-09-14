// TrustedContactsList — the trusted people summaries can be sent to, with
// add / edit / remove (spec §MVP 5).
//
// One component, five modes, same shape as PastSummaries so the flow stays
// a single mental thread:
//   list           -> everyone on the list (GET /api/contacts) — active links
//                     and pending invites in one array, invites shown greyed
//                     out with a "waiting to join" badge (rowKey/isInvited
//                     below tell the two apart)
//   add            -> add by email (POST /api/contacts); an email with no
//                     account gets invited, so 404 now means only "that
//                     email belongs to a different kind of account"
//   detail         -> one contact's card; invites get Resend/Cancel instead
//                     of the edit/remove entry points
//   edit           -> nickname + relationship only (PATCH /api/contacts/:linkId
//                     or /api/contacts/invites/:inviteId for a pending invite)
//   confirm-delete -> Remove/Cancel is TWO presses, never one (DELETE
//                     /api/contacts/:linkId or .../invites/:inviteId)
//
// Rows come from two independent id sequences (linkId for active links,
// inviteId for pending invites), so every row is keyed and looked up via
// rowKey(c), not linkId alone — an invited row's linkId is null.
//
// Rendered from App's VIEWS map, so props are { user, onNavigate } — only
// onNavigate('home') is used, to back the list out to the home screen
// (BottomNav has no Home item — the wireframe caps it at 3). The token
// scopes every request to the logged-in user.

import { useEffect, useState } from 'react';
import {
  addContact,
  cancelInvite,
  deleteContact,
  listContacts,
  resendInvite,
  updateContact,
  updateInvite,
} from '../adapters/contacts-adapters';
import { displayName, formatDate, isInvited, rowKey } from '../utils';
import './TrustedContactsList.css';

export default function TrustedContactsList({ onNavigate, initialAddEmail }) {
  const [items, setItems] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState(null);

  // Arriving from an invitation link opens the add form directly, with the
  // inviting contact's address already in it — one press from connected.
  // useState reads its argument only on first mount, which is what we want:
  // App switches `view` to 'contacts' in the same commit that supplies the
  // prop, then clears it, and this component must not reopen the form later.
  const [mode, setMode] = useState(initialAddEmail ? 'add' : 'list'); // list | add | detail | edit | confirm-delete
  const [selected, setSelected] = useState(null); // the open contact (full link record)
  const [isBusy, setIsBusy] = useState(false); // a request is in flight
  const [actionError, setActionError] = useState(null);

  // Add form fields (email only exists here; edit can't change it).
  const [addEmail, setAddEmail] = useState(initialAddEmail || '');
  // Nickname + relationship are shared by the add and edit forms — they're
  // seeded from '' (add) or the selected contact (edit) on entry.
  const [nickname, setNickname] = useState('');
  const [relationship, setRelationship] = useState('');

  // Named (not inline in the effect) so the load-error Try Again button can
  // re-run it. Resetting to the loading state first makes the retry visible.
  const load = async () => {
    setItems(null);
    setLoadError(null);
    const { data, error } = await listContacts();
    if (error) setLoadError("We couldn't load your contacts.");
    else setItems(data);
  };

  useEffect(() => {
    load();
  }, []);

  const openAdd = () => {
    setAddEmail('');
    setNickname('');
    setRelationship('');
    setActionError(null);
    setMode('add');
  };

  const openDetail = (contact) => {
    setSelected(contact);
    setActionError(null);
    setMode('detail');
  };

  const openEdit = () => {
    setNickname(selected.nickname || '');
    setRelationship(selected.relationship || '');
    setActionError(null);
    setMode('edit');
  };

  const backToList = () => {
    setSelected(null);
    setActionError(null);
    setMode('list');
  };

  // A 404 from any of the three invite endpoints means that invitation stopped
  // being pending while this card was open — the invitee registered, which
  // converts it into a real contact (or it was cancelled from another device).
  // The list is loaded once on mount and this screen never refetched, so
  // without this the stale row's Save / Resend / Cancel all failed with
  // "Please try again" — advice that is guaranteed to fail forever. Refetch,
  // drop back to the list, and say what changed.
  const handleStaleInvite = () => {
    load();
    setSelected(null);
    setMode('list');
    // Deliberately doesn't claim they joined: a 404 here also fires when the
    // invitation was cancelled from another device, and asserting the wrong
    // cause is worse than naming both. The refreshed list shows which it was.
    setActionError(
      "That invitation isn't waiting any more — they may have joined, or it was cancelled. Your list is up to date now."
    );
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setIsBusy(true);
    setActionError(null);
    const { error } = await addContact({
      contactEmail: addEmail.trim(),
      // Blank optional fields stay unset rather than becoming ''.
      nickname: nickname.trim() || undefined,
      relationship: relationship.trim() || undefined,
    });
    setIsBusy(false);
    if (error) {
      if (error.status === 404) {
        // Now means exactly one thing: an account exists on that email but
        // it isn't a trusted contact account. (An email with no account at
        // all gets invited instead of 404ing.)
        setActionError(
          "That email already belongs to a different kind of account. A trusted contact needs their own trusted contact account."
        );
      } else if (error.status === 409) {
        // Covers both "already linked" and "already invited" — we don't parse
        // the message. Reloading shows which one it was, and a pending
        // invitation's own card is where Send-again lives.
        setActionError('This person is already on your list.');
        load();
      } else if (error.status === 429) {
        setActionError(error.message);
      } else {
        setActionError("We couldn't add this contact. Please try again.");
      }
      return;
    }
    // Refetch rather than appending the new row: the server returns active
    // contacts before pending invites, and appending put a freshly added
    // REGISTERED contact underneath the greyed-out invitations — exactly the
    // ordering that server-side partitioning exists to prevent.
    load();
    setMode('list');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setIsBusy(true);
    setActionError(null);
    // Both fields always sent: the form shows both, so a cleared box means
    // "remove it" (null), not "leave it alone".
    const fields = {
      nickname: nickname.trim() || null,
      relationship: relationship.trim() || null,
    };
    const { data, error } = isInvited(selected)
      ? await updateInvite(selected.inviteId, fields)
      : await updateContact(selected.linkId, fields);
    setIsBusy(false);
    if (error) {
      if (isInvited(selected) && error.status === 404) {
        handleStaleInvite();
        return;
      }
      setActionError("We couldn't save your changes. Please try again.");
      return;
    }
    setSelected(data);
    // Keep the list in sync without refetching.
    setItems((list) => list.map((c) => (rowKey(c) === rowKey(data) ? data : c)));
    setMode('detail');
  };

  const handleDelete = async () => {
    setIsBusy(true);
    setActionError(null);
    const { error } = isInvited(selected)
      ? await cancelInvite(selected.inviteId)
      : await deleteContact(selected.linkId);
    setIsBusy(false);
    if (error) {
      if (isInvited(selected) && error.status === 404) {
        handleStaleInvite();
        return;
      }
      setActionError(
        isInvited(selected)
          ? "We couldn't cancel this invitation. Please try again."
          : "We couldn't remove this contact. Please try again."
      );
      setMode('detail');
      return;
    }
    const goneKey = rowKey(selected);
    setItems((list) => list.filter((c) => rowKey(c) !== goneKey));
    setSelected(null);
    setMode('list');
  };

  const handleResend = async () => {
    setIsBusy(true);
    setActionError(null);
    const { error } = await resendInvite(selected.inviteId);
    setIsBusy(false);
    if (error) {
      if (error.status === 404) {
        handleStaleInvite();
        return;
      }
      setActionError(
        error.status === 429
          ? 'We sent that invitation recently. Please try again later.'
          : "We couldn't send that invitation again. Please try again."
      );
      return;
    }
    setActionError('Invitation sent again.');
  };

  // ── list mode (also loading / error / empty) ──────────────────────────────

  if (mode === 'list') {
    return (
      <main className="trusted-contacts">
        <button
          type="button"
          className="trusted-contacts__back"
          onClick={() => onNavigate('home')}
          disabled={isBusy}
        >
          &larr; Home
        </button>
        <h1 className="trusted-contacts__heading">Your trusted contacts</h1>

        {items === null && !loadError && (
          <p className="trusted-contacts__hint">Loading&hellip;</p>
        )}
        {loadError && (
          <>
            <p className="trusted-contacts__error">{loadError}</p>
            <button type="button" className="trusted-contacts__primary" onClick={load}>
              Try again
            </button>
          </>
        )}
        {items !== null && items.length === 0 && (
          <p className="trusted-contacts__hint">
            No one here yet. Add the people you trust, and you can send them
            your summaries.
          </p>
        )}

        {items !== null && items.length > 0 && (
          <ul className="trusted-contacts__list">
            {items.map((c) => (
              <li key={rowKey(c)}>
                {/* The whole card is the tap target — no tiny icons. */}
                <button
                  type="button"
                  className={
                    isInvited(c)
                      ? 'trusted-contacts__item trusted-contacts__item--invited'
                      : 'trusted-contacts__item'
                  }
                  onClick={() => openDetail(c)}
                  disabled={isBusy}
                >
                  <span className="trusted-contacts__item-name">{displayName(c)}</span>
                  {c.relationship && (
                    <span className="trusted-contacts__item-relationship">
                      {c.relationship}
                    </span>
                  )}
                  <span className="trusted-contacts__item-email">{c.email}</span>
                  {/* Words, not just the grey: colour alone would be invisible
                      to a screen reader and easy to miss on a phone. */}
                  {isInvited(c) && (
                    <span className="trusted-contacts__item-badge">
                      Invited &middot; waiting for them to join
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="trusted-contacts__status" role="status" aria-live="polite">
          {actionError || ''}
        </p>

        {items !== null && (
          <button type="button" className="trusted-contacts__primary" onClick={openAdd}>
            Add a contact
          </button>
        )}
      </main>
    );
  }

  // ── add mode ──────────────────────────────────────────────────────────────

  if (mode === 'add') {
    return (
      <main className="trusted-contacts">
        {/* Backing out mid-request is disabled everywhere: leaving the mode
            clears `selected`, and a failed request would then re-render a
            mode that expects it (review: crashed during a failing delete). */}
        <button
          type="button"
          className="trusted-contacts__back"
          onClick={backToList}
          disabled={isBusy}
        >
          &larr; Cancel
        </button>
        <h1 className="trusted-contacts__heading">Add a contact</h1>
        <p className="trusted-contacts__hint">
          Enter their email. If they already have a trusted contact account,
          they go straight onto your list. If not, we&rsquo;ll email them an
          invitation and hold their place here until they join.
        </p>

        <form className="trusted-contacts__form" onSubmit={handleAdd}>
          <label className="trusted-contacts__label" htmlFor="contact-email">
            Their email:
          </label>
          <input
            id="contact-email"
            className="trusted-contacts__input"
            type="email"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            readOnly={isBusy}
            required
          />

          <label className="trusted-contacts__label" htmlFor="contact-nickname">
            What you call them (optional):
          </label>
          <input
            id="contact-nickname"
            className="trusted-contacts__input"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            readOnly={isBusy}
          />

          <label className="trusted-contacts__label" htmlFor="contact-relationship">
            Who they are to you (optional):
          </label>
          <input
            id="contact-relationship"
            className="trusted-contacts__input"
            type="text"
            placeholder="Daughter, neighbor, friend…"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            readOnly={isBusy}
          />

          <p className="trusted-contacts__status" role="status" aria-live="polite">
            {isBusy ? 'Adding…' : actionError || ''}
          </p>

          <button
            type="submit"
            className="trusted-contacts__primary"
            disabled={isBusy || addEmail.trim().length === 0}
          >
            {isBusy ? 'Adding…' : 'Add this person'}
          </button>
        </form>
      </main>
    );
  }

  // ── edit mode ─────────────────────────────────────────────────────────────

  if (mode === 'edit') {
    return (
      <main className="trusted-contacts">
        <button
          type="button"
          className="trusted-contacts__back"
          onClick={() => setMode('detail')}
          disabled={isBusy}
        >
          &larr; Cancel
        </button>
        <h1 className="trusted-contacts__heading">{displayName(selected)}</h1>
        <p className="trusted-contacts__hint">{selected.email}</p>

        <form className="trusted-contacts__form" onSubmit={handleSaveEdit}>
          <label className="trusted-contacts__label" htmlFor="edit-nickname">
            What you call them:
          </label>
          <input
            id="edit-nickname"
            className="trusted-contacts__input"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            readOnly={isBusy}
          />

          <label className="trusted-contacts__label" htmlFor="edit-relationship">
            Who they are to you:
          </label>
          <input
            id="edit-relationship"
            className="trusted-contacts__input"
            type="text"
            placeholder="Daughter, neighbor, friend…"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            readOnly={isBusy}
          />

          <p className="trusted-contacts__status" role="status" aria-live="polite">
            {isBusy ? 'Saving…' : actionError || ''}
          </p>

          <button type="submit" className="trusted-contacts__primary" disabled={isBusy}>
            {isBusy ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </main>
    );
  }

  // ── detail + confirm-delete modes ─────────────────────────────────────────

  return (
    <main className="trusted-contacts">
      <button
        type="button"
        className="trusted-contacts__back"
        onClick={backToList}
        disabled={isBusy}
      >
        &larr; All contacts
      </button>

      <h1 className="trusted-contacts__heading">{displayName(selected)}</h1>

      <dl className="trusted-contacts__facts">
        {/* An invited person has no registered name yet — show what we do know. */}
        {isInvited(selected) ? (
          <>
            <dt>Status</dt>
            <dd>Invited &middot; waiting for them to join</dd>
            {/* The only sensible input to "Send the invitation again" below is
                how long ago the last one went out — without this a three-week
                -old invitation looks identical to a three-hour-old one. */}
            <dt>Invited</dt>
            <dd>{formatDate(selected.invitedAt)}</dd>
          </>
        ) : (
          <>
            <dt>Name</dt>
            <dd>{selected.fullName}</dd>
          </>
        )}
        <dt>Email</dt>
        <dd>{selected.email}</dd>
        {selected.nickname && (
          <>
            <dt>You call them</dt>
            <dd>{selected.nickname}</dd>
          </>
        )}
        {selected.relationship && (
          <>
            <dt>Who they are</dt>
            <dd>{selected.relationship}</dd>
          </>
        )}
      </dl>

      <p className="trusted-contacts__status" role="status" aria-live="polite">
        {isBusy ? 'One moment…' : actionError || ''}
      </p>

      {mode === 'confirm-delete' ? (
        <>
          <p className="trusted-contacts__confirm">
            {isInvited(selected)
              ? `Cancel the invitation to ${selected.email}? They will not be able to join from the email we sent.`
              : `Remove ${displayName(selected)} from your list? They will no longer receive your summaries.`}
          </p>
          <button
            type="button"
            className="trusted-contacts__danger"
            onClick={handleDelete}
            disabled={isBusy}
          >
            {isInvited(selected) ? 'Yes, cancel it' : 'Yes, remove them'}
          </button>
          <button
            type="button"
            className="trusted-contacts__secondary"
            onClick={() => setMode('detail')}
            disabled={isBusy}
          >
            {isInvited(selected) ? 'No, keep waiting' : 'No, keep them'}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="trusted-contacts__primary"
            onClick={openEdit}
            disabled={isBusy}
          >
            Change nickname or relationship
          </button>
          {isInvited(selected) && (
            <button
              type="button"
              className="trusted-contacts__secondary"
              onClick={handleResend}
              disabled={isBusy}
            >
              Send the invitation again
            </button>
          )}
          <button
            type="button"
            className="trusted-contacts__secondary"
            onClick={() => setMode('confirm-delete')}
            disabled={isBusy}
          >
            {isInvited(selected) ? 'Cancel this invitation' : 'Remove this contact'}
          </button>
        </>
      )}
    </main>
  );
}
