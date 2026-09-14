# tests/test_contact_invites.py — trusted-contact invitations:
#   - the contact_invites table and its helpers (model layer)
#   - POST /api/contacts inviting an unregistered email
#   - the invite endpoints (patch / resend / cancel)
#   - acceptance: registering as a contact converts pending invites into links

from datetime import datetime, timedelta, timezone

import pytest

from core.security import create_access_token
from models import contact_model, invite_model, user_model
from models.invite_model import ContactInvite
from models.user_model import User


async def _user(session, *, email, full_name="U", role="primary"):
    user = User(email=email, password_hash="x", full_name=full_name, role=role)
    session.add(user)
    await session.flush()
    return user


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}


# ── model layer ───────────────────────────────────────────────────────────────


async def test_create_then_find_and_list_pending(session):
    owner = await _user(session, email="p@example.com")
    await session.commit()

    invite = await invite_model.create(
        session, owner.id, "new@example.com", "Mom", "mother"
    )
    assert invite.id is not None
    assert invite.accepted_at is None
    assert invite.created_at is not None
    assert invite.last_sent_at is not None

    found = await invite_model.find_any(session, owner.id, "new@example.com")
    assert found is not None and found.id == invite.id

    pending = await invite_model.list_pending_by_owner(session, owner.id)
    assert [i.id for i in pending] == [invite.id]


async def test_find_any_is_owner_scoped(session):
    a = await _user(session, email="a@example.com")
    b = await _user(session, email="b@example.com")
    await session.commit()

    await invite_model.create(session, a.id, "x@example.com", None, None)

    # b invited nobody — a's invite must be invisible to them.
    assert await invite_model.find_any(session, b.id, "x@example.com") is None


async def test_accepted_invites_are_excluded_from_pending_but_still_found(session):
    owner = await _user(session, email="p2@example.com")
    await session.commit()

    invite = await invite_model.create(session, owner.id, "acc@example.com", None, None)
    invite.accepted_at = datetime.now(timezone.utc)
    await session.commit()

    assert await invite_model.list_pending_by_owner(session, owner.id) == []
    # find_any still sees it — that's what makes revive possible.
    assert await invite_model.find_any(session, owner.id, "acc@example.com") is not None


async def test_revive_clears_acceptance_and_rewrites_labels(session):
    owner = await _user(session, email="p3@example.com")
    await session.commit()

    invite = await invite_model.create(session, owner.id, "rev@example.com", "Old", "old")
    old_created = invite_model.as_utc(invite.created_at)
    invite.accepted_at = datetime.now(timezone.utc)
    await session.commit()

    revived = await invite_model.revive(session, invite, "New", "new")
    assert revived.accepted_at is None
    assert revived.nickname == "New"
    assert revived.relationship == "new"
    assert invite_model.as_utc(revived.created_at) >= old_created


async def test_count_open_and_count_recent(session):
    owner = await _user(session, email="p4@example.com")
    await session.commit()

    # Three rows, each proving a different edge of the two helpers so that
    # neither can be satisfied by copying the other's filter:
    #   - pending + recent      -> counted by BOTH (the ordinary case)
    #   - accepted + recent     -> counted by count_recent ONLY. This is the
    #     row that matters: count_recent counts outbound email volume, not
    #     open invites, so an already-accepted invite still counts against
    #     the daily send cap. If count_recent secretly filtered on
    #     accepted_at IS NULL (i.e. behaved like count_open), this row would
    #     wrongly disappear from its count.
    #   - pending + backdated past 24h -> counted by count_open ONLY. This
    #     proves count_recent actually applies the time window rather than
    #     just deferring to "still pending".
    pending_recent = await invite_model.create(
        session, owner.id, "one@example.com", None, None
    )
    accepted_recent = await invite_model.create(
        session, owner.id, "two@example.com", None, None
    )
    accepted_recent.accepted_at = datetime.now(timezone.utc)
    pending_old = await invite_model.create(
        session, owner.id, "three@example.com", None, None
    )
    pending_old.created_at = datetime.now(timezone.utc) - timedelta(hours=30)
    await session.commit()

    # open: pending_recent + pending_old (accepted_recent is excluded — it's
    # accepted, not open).
    assert await invite_model.count_open(session, owner.id) == 2
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    # recent: pending_recent + accepted_recent (pending_old is excluded — it's
    # outside the window, despite still being pending).
    assert await invite_model.count_recent(session, owner.id, cutoff) == 2


async def test_cancel_pending_is_owner_scoped(session):
    a = await _user(session, email="da@example.com")
    b = await _user(session, email="db@example.com")
    await session.commit()

    invite = await invite_model.create(session, a.id, "z@example.com", None, None)

    assert await invite_model.cancel_pending(session, invite.id, b.id) is False
    # b's rejected call must not have stamped anything.
    assert invite.cancelled_at is None

    assert await invite_model.cancel_pending(session, invite.id, a.id) is True
    # Cancelling twice is not "cancelled again" — it's a 404 at the router.
    assert await invite_model.cancel_pending(session, invite.id, a.id) is False


async def test_cancel_pending_stamps_instead_of_deleting_the_row(session):
    """The soft delete itself. If this ever regresses to session.delete(), the
    24h invite cap becomes bypassable by cancelling — see the module header."""
    owner = await _user(session, email="soft@example.com")
    await session.commit()

    invite = await invite_model.create(session, owner.id, "soft1@example.com", None, None)
    invite_id = invite.id

    assert await invite_model.cancel_pending(session, invite_id, owner.id) is True

    # The row is STILL THERE, stamped — not gone.
    survivor = await invite_model.find_any(session, owner.id, "soft1@example.com")
    assert survivor is not None
    assert survivor.id == invite_id
    assert survivor.cancelled_at is not None
    # And it is not masquerading as accepted, which would send it down the
    # acceptance paths instead.
    assert survivor.accepted_at is None


async def test_a_cancelled_invite_is_not_live_but_still_counts_for_the_day(session):
    """The one asymmetry the soft delete exists to create: cancelled rows leave
    every "live" query but stay inside count_recent's window.

    A second, still-pending invite is present throughout so each assertion has
    to prove the CANCELLED row specifically was included/excluded — a helper
    that returned nothing at all would fail these too.
    """
    owner = await _user(session, email="halflife@example.com")
    await session.commit()

    cancelled = await invite_model.create(session, owner.id, "gone@example.com", None, None)
    await invite_model.create(session, owner.id, "kept@example.com", None, None)
    await invite_model.cancel_pending(session, cancelled.id, owner.id)

    # Not live: absent from the list, not open, not findable as pending.
    pending = await invite_model.list_pending_by_owner(session, owner.id)
    assert [i.email for i in pending] == ["kept@example.com"]
    assert await invite_model.count_open(session, owner.id) == 1
    assert await invite_model.find_pending(session, cancelled.id, owner.id) is None

    # Still counted for the day — both rows.
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    assert await invite_model.count_recent(session, owner.id, cutoff) == 2


async def test_a_cancelled_invite_is_not_accepted_on_registration(session):
    """Cancelling promises "they will not be able to join from the email we
    sent". A cancelled row must therefore never convert into a link.

    The same owner keeps a pending invite to a DIFFERENT address so this can't
    pass just because the acceptance lookup found nothing at all.
    """
    owner = await _user(session, email="withdrawn@example.com")
    await session.commit()

    cancelled = await invite_model.create(session, owner.id, "nope@example.com", None, None)
    await invite_model.create(session, owner.id, "yes@example.com", None, None)
    await invite_model.cancel_pending(session, cancelled.id, owner.id)

    for_cancelled = await invite_model.list_pending_for_email(session, "nope@example.com")
    assert for_cancelled == []
    for_pending = await invite_model.list_pending_for_email(session, "yes@example.com")
    assert [i.email for i in for_pending] == ["yes@example.com"]

    joiner = await _user(session, email="nope@example.com", role="contact")
    await session.commit()

    assert await invite_model.accept_for_user(session, joiner) == 0
    assert await contact_model.is_contact_of(session, owner.id, joiner.id) is False


async def test_revive_clears_a_cancellation_too(session):
    """revive has to clear BOTH stamps: a row that came back with cancelled_at
    still set would be invisible to every live query it must reappear in."""
    owner = await _user(session, email="mindchange@example.com")
    await session.commit()

    invite = await invite_model.create(session, owner.id, "again2@example.com", "Old", "old")
    await invite_model.cancel_pending(session, invite.id, owner.id)

    revived = await invite_model.revive(session, invite, "New", "new")
    assert revived.cancelled_at is None
    assert revived.accepted_at is None
    assert revived.nickname == "New"
    # Actually live again, not merely un-stamped in Python.
    pending = await invite_model.list_pending_by_owner(session, owner.id)
    assert [i.id for i in pending] == [invite.id]


async def test_accept_for_user_creates_links_for_every_inviter(session):
    a = await _user(session, email="ia@example.com")
    b = await _user(session, email="ib@example.com")
    await session.commit()

    await invite_model.create(session, a.id, "joins@example.com", "Kid", "son")
    await invite_model.create(session, b.id, "joins@example.com", None, None)
    await session.commit()

    contact = await _user(session, email="joins@example.com", role="contact")
    await session.commit()

    accepted = await invite_model.accept_for_user(session, contact)
    assert accepted == 2
    assert await contact_model.is_contact_of(session, a.id, contact.id) is True
    assert await contact_model.is_contact_of(session, b.id, contact.id) is True

    # Labels carry across from the invite onto the link.
    links = await contact_model.list_by_owner(session, a.id)
    assert [(l.nickname, l.relationship) for l, _ in links] == [("Kid", "son")]

    # And nothing is left pending.
    assert await invite_model.list_pending_by_owner(session, a.id) == []


async def test_accept_for_user_matches_email_case_insensitively(session):
    owner = await _user(session, email="ci@example.com")
    await session.commit()
    await invite_model.create(session, owner.id, "mixed@example.com", None, None)
    await session.commit()

    contact = await _user(session, email="MiXeD@example.com", role="contact")
    await session.commit()

    assert await invite_model.accept_for_user(session, contact) == 1


async def test_accept_for_user_skips_an_existing_link(session):
    """They were linked, deleted their account, re-registered while an invite
    was still pending — the link INSERT must be skipped, not raise."""
    owner = await _user(session, email="dup@example.com")
    contact = await _user(session, email="already@example.com", role="contact")
    await session.commit()

    await contact_model.create(session, owner.id, contact.id, None, None)
    await invite_model.create(session, owner.id, "already@example.com", None, None)
    await session.commit()

    assert await invite_model.accept_for_user(session, contact) == 1
    links = await contact_model.list_by_owner(session, owner.id)
    assert len(links) == 1  # not two


# ── GET /api/contacts (merged list) ───────────────────────────────────────────


async def test_list_returns_active_contacts_before_pending_invites(client, sessions):
    async with sessions() as s:
        owner = await _user(s, email="own@example.com", full_name="Owner")
        contact = await _user(
            s, email="real@example.com", full_name="Real Person", role="contact"
        )
        await s.commit()
        # The invite is created BEFORE the link, deliberately — if the router
        # ever regressed to merging the two row types by created_at/id instead
        # of partitioning by status, chronological order would put the invite
        # first and this test would catch it. Do not "tidy" this back to
        # creating the link first; that would make the assertion below pass
        # for the wrong reason (creation order) instead of the right one
        # (status partitioning).
        await invite_model.create(s, owner.id, "waiting@example.com", "Kid", "son")
        await contact_model.create(s, owner.id, contact.id, "Bestie", "friend")
        await s.commit()

    res = await client.get("/api/contacts", headers=_auth(owner))
    assert res.status_code == 200
    rows = res.json()
    assert [r["status"] for r in rows] == ["active", "invited"]

    active, invited = rows
    assert active["contactId"] == contact.id
    assert active["fullName"] == "Real Person"
    assert active["linkId"] is not None
    assert active["inviteId"] is None
    assert active["invitedAt"] is None

    assert invited["email"] == "waiting@example.com"
    assert invited["nickname"] == "Kid"
    assert invited["relationship"] == "son"
    assert invited["inviteId"] is not None
    assert invited["invitedAt"] is not None
    # Nobody has typed this person's name yet — the UI falls back to the email.
    assert invited["fullName"] is None
    assert invited["contactId"] is None
    assert invited["linkId"] is None


async def test_list_hides_another_owners_invites(client, sessions):
    # b gets their OWN pending invite so the assertion has to prove scoping —
    # not just absence. A broken join/filter that returned [] unconditionally
    # would satisfy `== []` but would also wrongly drop b's own invite.
    async with sessions() as s:
        a = await _user(s, email="la@example.com")
        b = await _user(s, email="lb@example.com")
        await s.commit()
        await invite_model.create(s, a.id, "secret@example.com", None, None)
        await invite_model.create(s, b.id, "mine@example.com", None, None)
        await s.commit()

    res = await client.get("/api/contacts", headers=_auth(b))
    rows = res.json()
    assert [r["email"] for r in rows] == ["mine@example.com"]


async def test_list_hides_accepted_invites(client, sessions):
    # The owner also has one still-PENDING invite, so the assertion proves the
    # accepted one is filtered out specifically — not that the query always
    # returns nothing.
    async with sessions() as s:
        owner = await _user(s, email="acc2@example.com")
        await s.commit()
        accepted = await invite_model.create(s, owner.id, "gone@example.com", None, None)
        accepted.accepted_at = datetime.now(timezone.utc)
        await invite_model.create(s, owner.id, "still@example.com", None, None)
        await s.commit()

    res = await client.get("/api/contacts", headers=_auth(owner))
    rows = res.json()
    assert [r["email"] for r in rows] == ["still@example.com"]


# ── POST /api/contacts (the invite branch) ────────────────────────────────────


@pytest.fixture
def invites_sent(monkeypatch):
    """Record invite emails instead of sending them. Patches the name bound in
    the ROUTER's namespace, the same way test_summary_images patches the send
    route's send_summary_email."""
    sent = []

    async def fake_send(to_email, from_name, signup_url):
        sent.append((to_email, from_name, signup_url))

    monkeypatch.setattr("routers.contacts.send_contact_invite_email", fake_send)
    return sent


async def test_adding_an_unregistered_email_creates_an_invite_and_emails_them(
    client, sessions, invites_sent
):
    async with sessions() as s:
        owner = await _user(s, email="inv@example.com", full_name="Eleanor P.")
        await s.commit()

    res = await client.post(
        "/api/contacts",
        json={
            "contactEmail": "Nobody@Example.com",
            "nickname": "Kid",
            "relationship": "son",
        },
        headers=_auth(owner),
    )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "invited"
    assert body["inviteId"] is not None
    assert body["contactId"] is None
    # Stored lowercased, whatever case the primary typed.
    assert body["email"] == "nobody@example.com"

    to_email, from_name, signup_url = invites_sent[0]
    assert to_email == "nobody@example.com"
    assert from_name == "Eleanor P."
    assert "invite=contact" in signup_url

    async with sessions() as s:
        assert await invite_model.find_any(s, owner.id, "nobody@example.com") is not None


async def test_adding_a_registered_contact_still_links_and_sends_no_invite(
    client, sessions, invites_sent
):
    """Regression guard on the pre-existing path."""
    async with sessions() as s:
        owner = await _user(s, email="reg@example.com")
        await _user(s, email="hascontact@example.com", role="contact")
        await s.commit()

    res = await client.post(
        "/api/contacts",
        json={"contactEmail": "hascontact@example.com"},
        headers=_auth(owner),
    )
    assert res.status_code == 201
    assert res.json()["status"] == "active"
    assert invites_sent == []


async def test_a_primary_role_email_still_404s_and_sends_no_invite(
    client, sessions, invites_sent
):
    async with sessions() as s:
        owner = await _user(s, email="wr@example.com")
        await _user(s, email="otherprimary@example.com", role="primary")
        await s.commit()

    res = await client.post(
        "/api/contacts",
        json={"contactEmail": "otherprimary@example.com"},
        headers=_auth(owner),
    )
    assert res.status_code == 404
    assert res.json()["message"] == "No account with that email"
    assert invites_sent == []

    async with sessions() as s:
        assert await invite_model.find_any(s, owner.id, "otherprimary@example.com") is None


async def test_inviting_the_same_email_twice_is_a_409(client, sessions, invites_sent):
    async with sessions() as s:
        owner = await _user(s, email="dup2@example.com")
        await s.commit()

    body = {"contactEmail": "twice@example.com"}
    assert (await client.post("/api/contacts", json=body, headers=_auth(owner))).status_code == 201
    second = await client.post("/api/contacts", json=body, headers=_auth(owner))
    assert second.status_code == 409
    assert second.json()["message"] == "You've already invited this person"
    assert len(invites_sent) == 1  # no second email


async def test_re_inviting_after_acceptance_revives_instead_of_colliding(
    client, sessions, invites_sent
):
    """They accepted, then deleted their account, so the email is unregistered
    again — but the kept accepted row still owns the UNIQUE."""
    async with sessions() as s:
        owner = await _user(s, email="rev2@example.com")
        await s.commit()
        invite = await invite_model.create(s, owner.id, "back@example.com", "Old", "old")
        invite.accepted_at = datetime.now(timezone.utc)
        await s.commit()
        invite_id = invite.id

    res = await client.post(
        "/api/contacts",
        json={"contactEmail": "back@example.com", "nickname": "New"},
        headers=_auth(owner),
    )
    assert res.status_code == 201
    assert res.json()["status"] == "invited"
    assert res.json()["inviteId"] == invite_id  # same row, revived
    assert res.json()["nickname"] == "New"
    assert len(invites_sent) == 1

    listed = await client.get("/api/contacts", headers=_auth(owner))
    assert [r["status"] for r in listed.json()] == ["invited"]


async def test_open_invite_cap_returns_429(client, sessions, invites_sent):
    """As written in the brief, this test created MAX_OPEN_INVITES pending
    rows all dated "now" — which makes count_open AND count_recent hit their
    caps simultaneously (both are 10 by coincidence), so a 429 here could come
    from either check. If the open-invite cap were deleted entirely, the
    request would still 429 off the daily cap and this test would not notice.

    Backdating past INVITE_WINDOW isolates it: count_open has no time filter
    (it's "still pending", full stop) so these still saturate it, while
    count_recent no longer sees them at all. A 429 here can only be the
    open-invite cap.
    """
    from routers.contacts import MAX_OPEN_INVITES

    async with sessions() as s:
        owner = await _user(s, email="cap@example.com")
        await s.commit()
        old = datetime.now(timezone.utc) - timedelta(hours=30)
        for n in range(MAX_OPEN_INVITES):
            invite = await invite_model.create(s, owner.id, f"p{n}@example.com", None, None)
            invite.created_at = old
        await s.commit()

    res = await client.post(
        "/api/contacts", json={"contactEmail": "onemore@example.com"}, headers=_auth(owner)
    )
    assert res.status_code == 429
    assert invites_sent == []


async def test_daily_cap_returns_429_and_the_window_expires(client, sessions, invites_sent):
    from routers.contacts import MAX_INVITES_PER_DAY

    async with sessions() as s:
        owner = await _user(s, email="daycap@example.com")
        await s.commit()
        # At the cap for the day, but all accepted so none are "open" — this
        # isolates the 24h cap from the open-invite cap.
        for n in range(MAX_INVITES_PER_DAY):
            invite = await invite_model.create(s, owner.id, f"d{n}@example.com", None, None)
            invite.accepted_at = datetime.now(timezone.utc)
        await s.commit()

    res = await client.post(
        "/api/contacts", json={"contactEmail": "blocked@example.com"}, headers=_auth(owner)
    )
    assert res.status_code == 429
    assert invites_sent == []

    # Backdate them past the window: the same request now succeeds.
    async with sessions() as s:
        for n in range(MAX_INVITES_PER_DAY):
            found = await invite_model.find_any(s, owner.id, f"d{n}@example.com")
            found.created_at = datetime.now(timezone.utc) - timedelta(hours=30)
        await s.commit()

    ok = await client.post(
        "/api/contacts", json={"contactEmail": "blocked@example.com"}, headers=_auth(owner)
    )
    assert ok.status_code == 201


async def test_a_failed_invite_email_records_nothing(client, sessions, monkeypatch):
    from core.email import EmailSendError

    async def boom(to_email, from_name, signup_url):
        raise EmailSendError("resend is down")

    monkeypatch.setattr("routers.contacts.send_contact_invite_email", boom)

    async with sessions() as s:
        owner = await _user(s, email="fail@example.com")
        await s.commit()

    res = await client.post(
        "/api/contacts", json={"contactEmail": "never@example.com"}, headers=_auth(owner)
    )
    assert res.status_code == 502

    async with sessions() as s:
        assert await invite_model.find_any(s, owner.id, "never@example.com") is None


async def test_an_invite_id_is_not_a_sendable_contact_id(client, sessions, invites_sent):
    """The whole reason invites live in their own table: nothing an invite owns
    can be passed to the send route as a contactId. This guards the invariant
    against a future refactor that merges the two id spaces."""
    from models.summary_model import Summary

    async with sessions() as s:
        owner = await _user(s, email="nosend@example.com")
        await s.commit()
        invite = await invite_model.create(s, owner.id, "pending@example.com", None, None)
        summary = Summary(user_id=owner.id, summary_text="hi", transcript="raw")
        s.add(summary)
        await s.commit()
        invite_id, summary_id = invite.id, summary.id

    res = await client.post(
        f"/api/summaries/{summary_id}/send",
        json={"contactIds": [invite_id]},
        headers=_auth(owner),
    )
    assert res.status_code == 403
    assert res.json()["message"] == "A contactId is not a trusted contact"


async def test_a_contact_role_user_cannot_invite(client, sessions, invites_sent):
    async with sessions() as s:
        contact = await _user(s, email="notprimary@example.com", role="contact")
        await s.commit()

    res = await client.post(
        "/api/contacts", json={"contactEmail": "x@example.com"}, headers=_auth(contact)
    )
    assert res.status_code == 403
    assert invites_sent == []


# ── invite endpoints ──────────────────────────────────────────────────────────


async def test_patch_invite_updates_labels(client, sessions):
    async with sessions() as s:
        owner = await _user(s, email="pi@example.com")
        await s.commit()
        invite = await invite_model.create(s, owner.id, "e@example.com", "Old", "old")
        await s.commit()
        invite_id = invite.id

    res = await client.patch(
        f"/api/contacts/invites/{invite_id}",
        json={"nickname": "Newer"},
        headers=_auth(owner),
    )
    assert res.status_code == 200
    assert res.json()["nickname"] == "Newer"
    # exclude_unset: an omitted field is left alone, not nulled.
    assert res.json()["relationship"] == "old"

    listed = await client.get("/api/contacts", headers=_auth(owner))
    assert listed.json()[0]["nickname"] == "Newer"


async def test_resend_sends_again_then_throttles(client, sessions, invites_sent):
    async with sessions() as s:
        owner = await _user(s, email="rs@example.com", full_name="Re Sender")
        await s.commit()
        invite = await invite_model.create(s, owner.id, "again@example.com", None, None)
        # Backdate the last send so the first resend is allowed.
        invite.last_sent_at = datetime.now(timezone.utc) - timedelta(hours=2)
        await s.commit()
        invite_id = invite.id

    first = await client.post(
        f"/api/contacts/invites/{invite_id}/resend", headers=_auth(owner)
    )
    assert first.status_code == 200
    assert len(invites_sent) == 1
    assert invites_sent[0][0] == "again@example.com"
    assert invites_sent[0][1] == "Re Sender"

    second = await client.post(
        f"/api/contacts/invites/{invite_id}/resend", headers=_auth(owner)
    )
    assert second.status_code == 429
    assert len(invites_sent) == 1  # no second email


async def test_cancel_invite_removes_it_from_the_list(client, sessions):
    async with sessions() as s:
        owner = await _user(s, email="cx@example.com")
        await s.commit()
        invite = await invite_model.create(s, owner.id, "bye@example.com", None, None)
        await s.commit()
        invite_id = invite.id

    res = await client.delete(f"/api/contacts/invites/{invite_id}", headers=_auth(owner))
    assert res.status_code == 200
    assert res.json()["message"] == "Invitation cancelled"

    listed = await client.get("/api/contacts", headers=_auth(owner))
    assert listed.json() == []
    # It's off the list and no longer "open" — but the ROW is still there,
    # stamped. Asserting only the empty list would pass against the hard delete
    # this replaced, which is what made the daily cap bypassable.
    async with sessions() as s:
        survivor = await invite_model.find_any(s, owner.id, "bye@example.com")
        assert survivor is not None
        assert survivor.id == invite_id
        assert survivor.cancelled_at is not None
        assert await invite_model.count_open(s, owner.id) == 0


async def test_cancelling_does_not_refund_the_daily_invite_cap(
    client, sessions, invites_sent
):
    """The abuse loop, closed. add -> cancel -> repeat used to send unlimited
    invitation email: cancel hard-deleted the row and count_recent only counts
    rows that still exist, so every cancellation refunded an allowance.

    Cancelling each one also keeps count_open at zero throughout, so the 429
    at the end can ONLY be the 24h cap — not the open-invite cap. Against the
    old hard delete, the final request below returns 201.
    """
    from routers.contacts import MAX_INVITES_PER_DAY

    async with sessions() as s:
        owner = await _user(s, email="loop@example.com")
        await s.commit()

    for n in range(MAX_INVITES_PER_DAY):
        created = await client.post(
            "/api/contacts",
            json={"contactEmail": f"loop{n}@example.com"},
            headers=_auth(owner),
        )
        assert created.status_code == 201, created.json()
        cancelled = await client.delete(
            f"/api/contacts/invites/{created.json()['inviteId']}", headers=_auth(owner)
        )
        assert cancelled.status_code == 200

    # Nothing is waiting, so the open-invite cap is nowhere near its limit.
    async with sessions() as s:
        assert await invite_model.count_open(s, owner.id) == 0

    blocked = await client.post(
        "/api/contacts", json={"contactEmail": "one-too-many@example.com"}, headers=_auth(owner)
    )
    assert blocked.status_code == 429
    # And crucially, no email was sent for the blocked one.
    assert len(invites_sent) == MAX_INVITES_PER_DAY


async def test_re_inviting_a_cancelled_address_revives_the_same_row(
    client, sessions, invites_sent
):
    """A cancelled row still owns UNIQUE (owner_id, email), so a primary who
    changes their mind must revive it — not collide with an IntegrityError."""
    async with sessions() as s:
        owner = await _user(s, email="again3@example.com")
        await s.commit()

    first = await client.post(
        "/api/contacts",
        json={"contactEmail": "mindchanged@example.com", "nickname": "Old"},
        headers=_auth(owner),
    )
    assert first.status_code == 201
    invite_id = first.json()["inviteId"]

    assert (
        await client.delete(f"/api/contacts/invites/{invite_id}", headers=_auth(owner))
    ).status_code == 200

    again = await client.post(
        "/api/contacts",
        json={"contactEmail": "mindchanged@example.com", "nickname": "New"},
        headers=_auth(owner),
    )
    assert again.status_code == 201, again.json()  # not 409, and not a 500 from the UNIQUE
    assert again.json()["inviteId"] == invite_id   # the same row, revived
    assert again.json()["nickname"] == "New"

    # Actually pending again: back on the list, and open once more.
    listed = await client.get("/api/contacts", headers=_auth(owner))
    assert [(r["status"], r["email"]) for r in listed.json()] == [
        ("invited", "mindchanged@example.com")
    ]
    async with sessions() as s:
        assert await invite_model.count_open(s, owner.id) == 1
    assert len(invites_sent) == 2  # both sends really happened


async def test_invite_endpoints_404_on_a_cancelled_invite(client, sessions, invites_sent):
    async with sessions() as s:
        owner = await _user(s, email="dead@example.com")
        await s.commit()
        invite = await invite_model.create(s, owner.id, "dead1@example.com", None, None)
        await invite_model.cancel_pending(s, invite.id, owner.id)
        invite_id = invite.id

    for call in (
        client.patch(
            f"/api/contacts/invites/{invite_id}", json={"nickname": "x"}, headers=_auth(owner)
        ),
        client.post(f"/api/contacts/invites/{invite_id}/resend", headers=_auth(owner)),
        client.delete(f"/api/contacts/invites/{invite_id}", headers=_auth(owner)),
    ):
        res = await call
        assert res.status_code == 404
        assert res.json()["message"] == "Invitation not found"
    assert invites_sent == []  # the resend really didn't send

    # Same reasoning as the once-accepted case: the 404 must come from "not
    # pending", not from the row having been removed — otherwise this would
    # pass against a cancel that deletes the row after all.
    async with sessions() as s:
        survivor = await invite_model.find_any(s, owner.id, "dead1@example.com")
        assert survivor is not None
        assert survivor.id == invite_id
        assert survivor.cancelled_at is not None


async def test_invite_endpoints_are_owner_scoped(client, sessions, invites_sent):
    async with sessions() as s:
        a = await _user(s, email="oa@example.com")
        b = await _user(s, email="ob@example.com")
        await s.commit()
        invite = await invite_model.create(s, a.id, "mine@example.com", None, None)
        await s.commit()
        invite_id = invite.id

    for call in (
        client.patch(
            f"/api/contacts/invites/{invite_id}", json={"nickname": "x"}, headers=_auth(b)
        ),
        client.post(f"/api/contacts/invites/{invite_id}/resend", headers=_auth(b)),
        client.delete(f"/api/contacts/invites/{invite_id}", headers=_auth(b)),
    ):
        res = await call
        assert res.status_code == 404
        assert res.json()["message"] == "Invitation not found"
    assert invites_sent == []

    # Prove the invite is untouched by b's rejected calls, not merely absent:
    # a can still see, resend, and edit it. If owner_id were ignored, b's
    # patch/delete above would have silently mutated or removed this row.
    async with sessions() as s:
        still_there = await invite_model.find_any(s, a.id, "mine@example.com")
        assert still_there is not None
        assert still_there.id == invite_id
        assert still_there.accepted_at is None


async def test_invite_endpoints_404_once_accepted(client, sessions):
    async with sessions() as s:
        owner = await _user(s, email="oncedone@example.com")
        await s.commit()
        invite = await invite_model.create(s, owner.id, "done@example.com", None, None)
        invite.accepted_at = datetime.now(timezone.utc)
        await s.commit()
        invite_id = invite.id

    res = await client.delete(f"/api/contacts/invites/{invite_id}", headers=_auth(owner))
    assert res.status_code == 404

    # The 404 must come from "not pending", not from the row being gone —
    # otherwise this test would equally pass against a delete that (wrongly)
    # ignores acceptance and just always 404s, or one that races and deletes
    # the row anyway despite reporting 404.
    async with sessions() as s:
        still_there = await invite_model.find_any(s, owner.id, "done@example.com")
        assert still_there is not None
        assert still_there.id == invite_id
        assert still_there.accepted_at is not None


# ── acceptance on registration ────────────────────────────────────────────────


async def test_registering_as_a_contact_accepts_the_invite(client, sessions):
    async with sessions() as s:
        owner = await _user(s, email="host@example.com")
        await s.commit()
        await invite_model.create(s, owner.id, "newbie@example.com", "Kid", "son")
        await s.commit()

    res = await client.post(
        "/api/auth/register",
        json={
            "email": "newbie@example.com",
            "password": "hunter2hunter2",
            "fullName": "New Bie",
            "role": "contact",
        },
    )
    assert res.status_code == 201

    # The greyed invite is now a real, usable contact — same list, new status.
    listed = await client.get("/api/contacts", headers=_auth(owner))
    rows = listed.json()
    assert [r["status"] for r in rows] == ["active"]
    assert rows[0]["fullName"] == "New Bie"
    assert rows[0]["nickname"] == "Kid"          # labels carried across
    assert rows[0]["relationship"] == "son"
    assert rows[0]["contactId"] is not None      # now sendable


async def test_registering_as_a_primary_does_not_accept_the_invite(client, sessions):
    async with sessions() as s:
        owner = await _user(s, email="host2@example.com")
        await s.commit()
        await invite_model.create(s, owner.id, "wrongrole@example.com", None, None)
        await s.commit()

    res = await client.post(
        "/api/auth/register",
        json={
            "email": "wrongrole@example.com",
            "password": "hunter2hunter2",
            "fullName": "Wrong Role",
            "role": "primary",
        },
    )
    assert res.status_code == 201

    listed = await client.get("/api/contacts", headers=_auth(owner))
    assert [r["status"] for r in listed.json()] == ["invited"]

    # Strengthened beyond the brief: the list view alone wouldn't distinguish
    # "invite still pending" from "invite was deleted and something else in
    # the response happens to read as invited" (it wouldn't here, since an
    # empty list fails the assert above too, but this pins the actual model
    # state directly, the same way test_invite_endpoints_404_once_accepted
    # does elsewhere in this file). A bug that deleted the invite outright,
    # or one that flipped accepted_at despite the role guard, must fail here.
    async with sessions() as s:
        still_there = await invite_model.find_any(s, owner.id, "wrongrole@example.com")
        assert still_there is not None
        assert still_there.accepted_at is None


async def test_acceptance_links_every_inviter_at_once(client, sessions):
    async with sessions() as s:
        a = await _user(s, email="h1@example.com")
        b = await _user(s, email="h2@example.com")
        await s.commit()
        await invite_model.create(s, a.id, "popular@example.com", None, None)
        await invite_model.create(s, b.id, "popular@example.com", None, None)
        await s.commit()

    res = await client.post(
        "/api/auth/register",
        json={
            "email": "popular@example.com",
            "password": "hunter2hunter2",
            "fullName": "Pop U Lar",
            "role": "contact",
        },
    )
    assert res.status_code == 201

    # Collect both owners' statuses before asserting on either — a bug that
    # only links ONE of the two inviters must not get to hide behind pytest
    # stopping at the first failed assert; both lists are actually inspected.
    statuses = {}
    for owner in (a, b):
        listed = await client.get("/api/contacts", headers=_auth(owner))
        statuses[owner.email] = [r["status"] for r in listed.json()]

    assert statuses == {
        "h1@example.com": ["active"],
        "h2@example.com": ["active"],
    }


async def test_registration_still_succeeds_when_acceptance_blows_up(
    client, sessions, monkeypatch
):
    """A stale invite must never stop someone from creating an account."""

    async def boom(session, user):
        raise RuntimeError("invite conversion exploded")

    monkeypatch.setattr("routers.auth.invite_model.accept_for_user", boom)

    res = await client.post(
        "/api/auth/register",
        json={
            "email": "resilient@example.com",
            "password": "hunter2hunter2",
            "fullName": "Res Ilient",
            "role": "contact",
        },
    )
    assert res.status_code == 201
    assert res.json()["token"]

    # Strengthened beyond the brief: a truthy token alone doesn't prove the
    # account was actually persisted (a bug could mint a token for a user
    # that never got committed). Confirm the row is really there.
    async with sessions() as s:
        created = await user_model.find_by_email(s, "resilient@example.com")
        assert created is not None
        assert created.full_name == "Res Ilient"
