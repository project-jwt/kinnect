// ChooseAction — the step after a summary is saved: get it to a real human
// (spec §MVP 2, 4; wireframe "choose action" screen).
//
// One component, three modes, same shape as PastSummaries/TrustedContactsList
// so the flow stays a single mental thread:
//   choose        -> exactly two big actions: send to trusted contacts, or
//                    call for help (routes to the helpline screen — F7)
//   pick-contacts -> checkbox list of trusted contacts (GET /api/contacts),
//                    then POST /api/summaries/:id/send
//   sent          -> confirmation naming who the summary was emailed to
//
// Rendered explicitly from App (like recording/review) because it needs the
// just-saved summary's id, which the uniform VIEWS map can't carry.
//
// Props:
//   summaryId — the summary that was just saved (what /:id/send takes)
//   onNavigate(view) — App's view switcher (helpline / contacts / home)
//   onBusyChange(bool) — tells App a send is in flight so it can freeze
//                        BottomNav (navigating away mid-request loses the
//                        outcome and invites a re-send)

import { useEffect, useState } from 'react';
import { listContacts } from '../adapters/contacts-adapters';
import { sendSummary } from '../adapters/summaries-adapters';
import { displayName, isInvited, rowKey } from '../utils';
import './ChooseAction.css';

// Invited people have no contactId, so there is nothing the send endpoint
// could accept for them — they're shown for continuity, never selectable.

export default function ChooseAction({ summaryId, onNavigate, onBusyChange }) {
  const [mode, setMode] = useState('choose'); // choose | pick-contacts | sent
  const [contacts, setContacts] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isBusy, setIsBusy] = useState(false); // the send request is in flight
  const [actionError, setActionError] = useState(null);
  const [sentNames, setSentNames] = useState([]); // for the confirmation

  // Mirror the in-flight state up to App so BottomNav freezes too — this
  // screen already disables its own controls mid-send for exactly this
  // reason. The cleanup unfreezes the nav if we unmount some other way.
  useEffect(() => {
    onBusyChange?.(isBusy);
    return () => onBusyChange?.(false);
  }, [isBusy, onBusyChange]);

  // Named (not inline in an effect) so the load-error Try Again button can
  // re-run it. Resetting to the loading state first makes the retry visible.
  const loadContacts = async () => {
    setContacts(null);
    setLoadError(null);
    const { data, error } = await listContacts();
    if (error) setLoadError("We couldn't load your contacts.");
    else setContacts(data);
  };

  const openPicker = () => {
    setSelectedIds(new Set());
    setActionError(null);
    setMode('pick-contacts');
    loadContacts();
  };

  const toggleContact = (contactId) => {
    if (!contactId) return; // an invited row — nothing to send to yet
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const handleSend = async () => {
    setIsBusy(true);
    setActionError(null);
    const { data, error } = await sendSummary(summaryId, [...selectedIds]);
    setIsBusy(false);
    if (error) {
      if (error.status === 403) {
        // Someone picked is no longer a trusted contact — our list is stale,
        // so retrying the same ids would fail forever. Refetch and restart
        // the selection.
        setActionError(
          'Someone you picked is no longer on your contact list. Please look over the list and try again.'
        );
        setSelectedIds(new Set());
        loadContacts();
      } else if (error.status === 502) {
        // The email service failed partway: no sends were recorded, but the
        // backend emails sequentially, so some may already have been
        // delivered — don't promise a clean retry. The summary itself is
        // safe either way.
        setActionError(
          'Some of the emails may have already gone out. Your summary is saved — please check with your contacts before sending again.'
        );
      } else {
        setActionError("We couldn't send your summary. Please try again.");
      }
      return;
    }
    // Name the recipients on the confirmation — map the response's ids back
    // to the contacts we listed.
    const sentIds = new Set(data.sentTo.map((s) => s.contactId));
    setSentNames(contacts.filter((c) => sentIds.has(c.contactId)).map(displayName));
    setMode('sent');
  };

  // ── choose mode ───────────────────────────────────────────────────────────

  if (mode === 'choose') {
    return (
      <main className="choose-action">
        {/* Neither action is mandatory — Home is always a way out. */}
        <button
          type="button"
          className="choose-action__back"
          onClick={() => onNavigate('home')}
        >
          &larr; Home
        </button>

        <h1 className="choose-action__heading">Saved</h1>
        <p className="choose-action__hint">
          Your summary is safe — you can find it any time under History. What
          would you like to do next?
        </p>

        {/* The wireframe's one exception to one-action-per-screen: exactly
            these two. Send is the filled, dominant one. */}
        <button type="button" className="choose-action__primary" onClick={openPicker}>
          Send to my trusted contacts
        </button>
        <button
          type="button"
          className="choose-action__secondary"
          onClick={() => onNavigate('helpline')}
        >
          Call for help
        </button>
      </main>
    );
  }

  // ── sent mode (confirmation) ──────────────────────────────────────────────

  if (mode === 'sent') {
    return (
      <main className="choose-action">
        <h1 className="choose-action__heading">Sent</h1>
        <p className="choose-action__hint">
          Your summary was emailed to: {sentNames.join(', ')}.
        </p>
        <button
          type="button"
          className="choose-action__primary"
          onClick={() => onNavigate('home')}
        >
          Done
        </button>
      </main>
    );
  }

  // ── pick-contacts mode (also loading / error / empty) ────────────────────

  // One always-mounted live region carries every transient message (loading,
  // load failure, send progress, send errors). It must exist before the
  // message does: a live region that mounts already holding text — or that
  // unmounts and remounts around a state change — is never announced, which
  // is how the 403 message was getting lost.
  const statusText = isBusy
    ? 'Sending…'
    : actionError || loadError || (contacts === null ? 'Loading…' : '');

  return (
    <main className="choose-action">
      {/* Greyed out while the send is in flight — leaving a mode mid-request
          is the bug class the F4 review caught. */}
      <button
        type="button"
        className="choose-action__back"
        onClick={() => setMode('choose')}
        disabled={isBusy}
      >
        &larr; Back
      </button>

      <h1 className="choose-action__heading">Who should get it?</h1>

      {contacts !== null && contacts.length === 0 && (
        <p className="choose-action__hint">
          You haven&rsquo;t added any trusted contacts yet. Add the people
          you trust &mdash; then you can send this summary any time from
          History.
        </p>
      )}

      {contacts !== null && contacts.length > 0 && (
        <>
          <p className="choose-action__hint">Pick one or more people.</p>
          <ul className="choose-action__list">
            {contacts.map((c) => (
              <li key={rowKey(c)}>
                {/* The whole card is the tap target; the checkbox rides
                    along inside the label. */}
                <label
                  className={
                    'choose-action__contact' +
                    (selectedIds.has(c.contactId) ? ' choose-action__contact--selected' : '') +
                    (isInvited(c) ? ' choose-action__contact--invited' : '')
                  }
                >
                  <input
                    type="checkbox"
                    className="choose-action__checkbox"
                    checked={selectedIds.has(c.contactId)}
                    onChange={() => toggleContact(c.contactId)}
                    disabled={isBusy || isInvited(c)}
                  />
                  <span className="choose-action__contact-text">
                    <span className="choose-action__contact-name">{displayName(c)}</span>
                    <span className="choose-action__contact-email">{c.email}</span>
                    {/* Words, not just the dimming — colour alone would be
                        invisible to a screen reader. */}
                    {isInvited(c) && (
                      <span className="choose-action__contact-badge">
                        Invited &middot; can&rsquo;t receive summaries yet
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {contacts !== null &&
        contacts.length > 0 &&
        contacts.every(isInvited) && (
          <p className="choose-action__hint">
            Everyone on your list is still waiting to join. Once they create
            their account, you can send them summaries.
          </p>
        )}

      <p className="choose-action__status" role="status" aria-live="polite">
        {statusText}
      </p>

      {loadError && (
        <button type="button" className="choose-action__primary" onClick={loadContacts}>
          Try again
        </button>
      )}
      {contacts !== null && contacts.length === 0 && (
        <button
          type="button"
          className="choose-action__primary"
          onClick={() => onNavigate('contacts')}
        >
          Add a contact
        </button>
      )}
      {contacts !== null && contacts.length > 0 && (
        <button
          type="button"
          className="choose-action__primary"
          onClick={handleSend}
          disabled={isBusy || selectedIds.size === 0}
        >
          {isBusy ? 'Sending…' : 'Send my summary'}
        </button>
      )}
    </main>
  );
}
