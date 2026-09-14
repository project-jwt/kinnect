// ContactDashboard — the one read-only screen a trusted contact sees:
// everything that has been sent to them, newest first (spec §MVP 1,
// Contact Dashboard; GET /api/received-summaries).
//
// One component, two modes, same shape as PastSummaries but read-only:
//   list   -> sender + date + first-line preview per card
//   detail -> the full summary text (already in the list payload — the
//             API returns full summaryText, so opening a card needs no
//             second request)
//
// App renders this whenever user.role === 'contact'; props are { user },
// which isn't needed here (the token scopes the request to the logged-in
// contact).

import { useEffect, useRef, useState } from 'react';
import { invitePrimary } from '../adapters/invitations-adapters';
import {
  getReceivedSummaryImageBlob,
  listReceivedSummaries,
} from '../adapters/received-summaries-adapters';
import { formatDate } from '../utils';
import './ContactDashboard.css';

export default function ContactDashboard({ roleMismatch, onDismissRoleMismatch }) {
  const [items, setItems] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null); // open summary, null = list mode

  // The invite screen. A trusted contact has no BottomNav, so this is reached
  // from the dashboard itself and checked before detail/list in the render.
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [inviteStatus, setInviteStatus] = useState(null);

  // Object URLs for the open summary's photos (imageId -> URL), tracked in a
  // ref so they can be revoked when the summary changes or the screen unmounts.
  const [imageUrls, setImageUrls] = useState({});
  const objectUrls = useRef([]);
  const revokeImageUrls = () => {
    objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.current = [];
  };

  // Named (not inline in the effect) so the load-error Try Again button can
  // re-run it. Resetting to the loading state first makes the retry visible.
  const load = async () => {
    setItems(null);
    setLoadError(null);
    const { data, error } = await listReceivedSummaries();
    if (error) setLoadError("We couldn't load your summaries.");
    else setItems(data);
  };

  const openInvite = () => {
    setInviteEmail('');
    setInviteStatus(null);
    setInviting(true);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setIsBusy(true);
    setInviteStatus(null);
    const address = inviteEmail.trim();
    const { error } = await invitePrimary(address);
    setIsBusy(false);
    if (error) {
      setInviteStatus(
        error.status === 502
          ? "We couldn't send that invitation right now. Please try again."
          : "We couldn't send that invitation. Please check the email address and try again."
      );
      return;
    }
    // Nothing is stored server-side, so there is no pending-invitation list to
    // show them — this message is the only confirmation they get. Clear the
    // field so a second press can't silently re-send to the same address.
    setInviteStatus(`Invitation sent to ${address}.`);
    setInviteEmail('');
  };

  useEffect(() => {
    load();
  }, []);

  // When a summary opens, fetch its photos' bytes (each behind auth) and turn
  // them into object URLs. Revokes the previous set first; the list-item
  // payload already carries the image metadata.
  useEffect(() => {
    let cancelled = false;
    revokeImageUrls();
    setImageUrls({});
    if (selected?.images?.length) {
      (async () => {
        const urls = {};
        for (const img of selected.images) {
          const { data: blob } = await getReceivedSummaryImageBlob(selected.summaryId, img.id);
          if (blob && !cancelled) {
            const url = URL.createObjectURL(blob);
            urls[img.id] = url;
            objectUrls.current.push(url);
          }
        }
        if (!cancelled) setImageUrls(urls);
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Revoke any outstanding URLs when the screen unmounts.
  useEffect(() => revokeImageUrls, []);

  // ── invite mode ───────────────────────────────────────────────────────────
  // Checked before detail/list: this is the one action a trusted contact has,
  // and it is reached from the dashboard rather than from nav (they have none).

  if (inviting) {
    return (
      <main className="contact-dashboard">
        <button
          type="button"
          className="contact-dashboard__back"
          onClick={() => setInviting(false)}
          disabled={isBusy}
        >
          &larr; Back
        </button>
        <h1 className="contact-dashboard__heading">Invite someone</h1>
        <p className="contact-dashboard__hint">
          We&rsquo;ll email them an invitation to set up their own account and
          add you, so their summaries start reaching you.
        </p>

        <form className="contact-dashboard__form" onSubmit={handleInvite}>
          <label className="contact-dashboard__label" htmlFor="invite-email">
            Their email:
          </label>
          <input
            id="invite-email"
            className="contact-dashboard__input"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            readOnly={isBusy}
            required
          />

          <p className="contact-dashboard__status" role="status" aria-live="polite">
            {isBusy ? 'Sending…' : inviteStatus || ''}
          </p>

          <button
            type="submit"
            className="contact-dashboard__primary"
            disabled={isBusy || inviteEmail.trim().length === 0}
          >
            {isBusy ? 'Sending…' : 'Send the invitation'}
          </button>
        </form>
      </main>
    );
  }

  // ── detail mode ───────────────────────────────────────────────────────────

  if (selected) {
    return (
      <main className="contact-dashboard">
        <button
          type="button"
          className="contact-dashboard__back"
          onClick={() => setSelected(null)}
        >
          &larr; All summaries
        </button>

        <h1 className="contact-dashboard__heading">
          From {selected.from.fullName}
        </h1>
        <p className="contact-dashboard__date">{formatDate(selected.sentAt)}</p>

        {/* pre-line — the same rendering History gives the sender, so both
            sides see identical layout of identical text. */}
        <p className="contact-dashboard__text">{selected.summaryText}</p>

        {/* Photos the sender attached — read-only on this side. */}
        {selected.images?.length > 0 && (
          <section className="contact-dashboard__photos" aria-labelledby="cd-photos-h">
            <h2 id="cd-photos-h" className="contact-dashboard__photos-heading">Photos</h2>
            <ul className="contact-dashboard__photo-list">
              {selected.images.map((img) => (
                <li key={img.id} className="contact-dashboard__photo">
                  {imageUrls[img.id] ? (
                    <img
                      className="contact-dashboard__photo-img"
                      src={imageUrls[img.id]}
                      alt={img.filename || 'Attached photo'}
                    />
                  ) : (
                    <span className="contact-dashboard__photo-fallback">Loading photo&hellip;</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    );
  }

  // ── list mode (also loading / error / empty) ──────────────────────────────

  return (
    <main className="contact-dashboard">
      <h1 className="contact-dashboard__heading">Summaries sent to you</h1>

      {/* They followed an invitation meant for setting up their OWN account but
          registered as a trusted contact, so the connection the invitation
          existed to make cannot happen — two trusted contacts have no
          relationship to each other. Without this they'd see a normal empty
          dashboard and reasonably assume it had worked. */}
      {roleMismatch && (
        <div className="contact-dashboard__notice" role="status" aria-live="polite">
          <p>
            The invitation you followed was for setting up your own account, so
            the person who sent it could receive <em>your</em> summaries.
            You&rsquo;ve signed up as a trusted contact instead, which means
            you&rsquo;ll receive summaries rather than send them.
          </p>
          <p>
            If you meant to share your own updates, ask them to invite you
            again and choose &ldquo;Here for myself&rdquo; &mdash; you&rsquo;ll
            need a different email address, since this one is now in use.
          </p>
          <button
            type="button"
            className="contact-dashboard__primary"
            onClick={onDismissRoleMismatch}
          >
            Got it
          </button>
        </div>
      )}

      {/* Always-mounted live region for the transient states — a live region
          that mounts already holding text is never announced, so the element
          has to exist before the message does. */}
      <p className="contact-dashboard__status" role="status" aria-live="polite">
        {loadError || (items === null ? 'Loading…' : '')}
      </p>
      {loadError && (
        <button type="button" className="contact-dashboard__primary" onClick={load}>
          Try again
        </button>
      )}
      {items !== null && items.length === 0 && (
        <p className="contact-dashboard__hint">
          Nothing here yet. When someone sends you a summary, it will show up
          on this page &mdash; or invite the person you look after to get
          started.
        </p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="contact-dashboard__list">
          {items.map((s) => (
            // The backend deliberately allows re-sending the same summary, so
            // summaryId alone can repeat — the timestamp disambiguates.
            <li key={`${s.summaryId}-${s.sentAt}`}>
              {/* The whole card is the tap target — no tiny icons. */}
              <button
                type="button"
                className="contact-dashboard__item"
                onClick={() => setSelected(s)}
              >
                <span className="contact-dashboard__item-sender">
                  From {s.from.fullName}
                </span>
                <span className="contact-dashboard__item-date">{formatDate(s.sentAt)}</span>
                <span className="contact-dashboard__item-preview">
                  {s.summaryText.split('\n')[0]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Rendered once the list has settled either way — a contact with no
          summaries yet is exactly who most needs this. */}
      {items !== null && (
        <button
          type="button"
          className="contact-dashboard__primary"
          onClick={openInvite}
        >
          Invite someone
        </button>
      )}
    </main>
  );
}
