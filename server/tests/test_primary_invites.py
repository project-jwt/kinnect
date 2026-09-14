# tests/test_primary_invites.py — the REVERSE invitation direction: a trusted
# contact invites someone to create a primary account and add them.
#
# Two layers in one file, because the feature is one endpoint and one email:
#   - the email params and the signup link (no Resend calls; the SDK's send is
#     replaced with a recorder)
#   - POST /api/invitations/primary (role gate, 502, no-enumeration)

import pytest
import resend

from core.email import (
    EmailSendError,
    primary_signup_url,
    send_primary_invite_email,
)
from core.security import create_access_token
from models.user_model import User


async def _user(session, *, email, full_name="U", role="contact"):
    user = User(email=email, password_hash="x", full_name=full_name, role=role)
    session.add(user)
    await session.flush()
    return user


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}


@pytest.fixture
def sent(monkeypatch):
    """Capture the params dict instead of calling Resend."""
    captured = []
    monkeypatch.setattr(resend.Emails, "send", lambda params: captured.append(params))
    return captured


# ── the email + the link ──────────────────────────────────────────────────────


async def test_invite_names_the_contact_and_carries_their_address(sent):
    await send_primary_invite_email(
        "newprimary@example.com",
        from_name="Chris Hackett",
        from_email="chris@example.com",
        signup_url="http://x/?invite=primary&email=a%40b.com&contact=chris%40example.com",
    )
    assert len(sent) == 1
    params = sent[0]
    assert params["to"] == ["newprimary@example.com"]
    assert "Chris Hackett" in params["subject"]
    assert "Chris Hackett" in params["html"]
    # The whole mechanism: the primary needs this address to add them.
    assert "chris@example.com" in params["html"]
    # & in the href must be escaped for HTML, so the link survives intact.
    assert "&amp;contact=chris%40example.com" in params["html"]
    # Nothing has been shared yet, so there is no health content to leak.
    assert "attachments" not in params


async def test_invite_escapes_the_contacts_name_and_address(sent):
    await send_primary_invite_email(
        "a@example.com",
        from_name="<script>x</script>",
        from_email="<b>me</b>@example.com",
        signup_url="http://x/",
    )
    html = sent[0]["html"]
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "<b>me</b>" not in html


async def test_invite_falls_back_when_the_contact_has_no_name(sent):
    await send_primary_invite_email(
        "a@example.com", from_name=None, from_email="c@example.com", signup_url="http://x/"
    )
    assert "Someone" in sent[0]["subject"]


async def test_invite_wraps_provider_failures(monkeypatch):
    def boom(params):
        raise resend.exceptions.ResendError(
            code=500, message="down", error_type="x", suggested_action="y"
        )

    monkeypatch.setattr(resend.Emails, "send", boom)
    with pytest.raises(EmailSendError):
        await send_primary_invite_email(
            "a@example.com", from_name="C", from_email="c@example.com", signup_url="http://x/"
        )


def test_signup_url_carries_both_addresses_encoded(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "app_base_url", "https://app.example.com/")
    url = primary_signup_url("new+user@example.com", "chris@example.com")
    assert url == (
        "https://app.example.com/?invite=primary"
        "&email=new%2Buser%40example.com"
        "&contact=chris%40example.com"
    )


# ── POST /api/invitations/primary ─────────────────────────────────────────────


@pytest.fixture
def invites_sent(monkeypatch):
    """Record invitations instead of sending them, patching the name bound in
    the ROUTER's namespace (the same way test_contact_invites.py does)."""
    sent = []

    async def fake_send(to_email, from_name, from_email, signup_url):
        sent.append(
            {
                "to": to_email,
                "from_name": from_name,
                "from_email": from_email,
                "url": signup_url,
            }
        )

    monkeypatch.setattr("routers.invitations.send_primary_invite_email", fake_send)
    return sent


async def test_a_contact_can_invite_a_primary(client, sessions, invites_sent):
    async with sessions() as s:
        contact = await _user(
            s, email="chris@example.com", full_name="Chris Hackett", role="contact"
        )
        await s.commit()

    res = await client.post(
        "/api/invitations/primary",
        json={"email": "newprimary@example.com"},
        headers=_auth(contact),
    )
    assert res.status_code == 200
    assert res.json()["message"] == "Invitation sent"

    assert len(invites_sent) == 1
    got = invites_sent[0]
    assert got["to"] == "newprimary@example.com"
    assert got["from_name"] == "Chris Hackett"
    assert got["from_email"] == "chris@example.com"
    assert "invite=primary" in got["url"]
    assert "contact=chris%40example.com" in got["url"]


async def test_the_address_is_sent_exactly_as_typed(client, sessions, invites_sent):
    """No lowercasing, deliberately. The forward direction lowercases because it
    STORES the address and later matches on it; here nothing is stored and
    nothing is matched, so normalizing would be cargo-culted. This test fails if
    someone adds a .lower() for symmetry with contacts.py."""
    async with sessions() as s:
        contact = await _user(s, email="c5@example.com", role="contact")
        await s.commit()

    res = await client.post(
        "/api/invitations/primary",
        json={"email": "MiXeD.Case@Example.com"},
        headers=_auth(contact),
    )
    assert res.status_code == 200
    # EmailStr lowercases the DOMAIN only; the local part must survive as typed.
    assert invites_sent[0]["to"] == "MiXeD.Case@example.com"


async def test_a_primary_cannot_invite_a_primary(client, sessions, invites_sent):
    """The role gate: this endpoint belongs to contacts only."""
    async with sessions() as s:
        primary = await _user(s, email="p@example.com", role="primary")
        await s.commit()

    res = await client.post(
        "/api/invitations/primary",
        json={"email": "someone@example.com"},
        headers=_auth(primary),
    )
    assert res.status_code == 403
    assert invites_sent == []


async def test_an_anonymous_request_is_rejected(client, invites_sent):
    res = await client.post(
        "/api/invitations/primary", json={"email": "someone@example.com"}
    )
    assert res.status_code == 401
    assert invites_sent == []


async def test_a_malformed_address_is_rejected_before_sending(
    client, sessions, invites_sent
):
    async with sessions() as s:
        contact = await _user(s, email="c2@example.com", role="contact")
        await s.commit()

    res = await client.post(
        "/api/invitations/primary", json={"email": "not-an-email"}, headers=_auth(contact)
    )
    assert res.status_code == 422
    assert invites_sent == []


async def test_a_provider_failure_is_a_502(client, sessions, monkeypatch):
    from core.email import EmailSendError

    async def boom(to_email, from_name, from_email, signup_url):
        raise EmailSendError("resend is down")

    monkeypatch.setattr("routers.invitations.send_primary_invite_email", boom)

    async with sessions() as s:
        contact = await _user(s, email="c3@example.com", role="contact")
        await s.commit()

    res = await client.post(
        "/api/invitations/primary",
        json={"email": "nobody@example.com"},
        headers=_auth(contact),
    )
    assert res.status_code == 502


async def test_the_response_does_not_reveal_whether_the_address_is_registered(
    client, sessions, invites_sent
):
    """The no-enumeration property, and the reason this endpoint does no account
    lookup at all: all three cases must be indistinguishable to the caller."""
    async with sessions() as s:
        contact = await _user(s, email="c4@example.com", role="contact")
        await _user(s, email="existing-primary@example.com", role="primary")
        await _user(s, email="existing-contact@example.com", role="contact")
        await s.commit()

    responses = []
    for address in (
        "brand-new@example.com",
        "existing-primary@example.com",
        "existing-contact@example.com",
    ):
        r = await client.post(
            "/api/invitations/primary", json={"email": address}, headers=_auth(contact)
        )
        responses.append((r.status_code, r.json()))

    # Identical status AND body for all three — no branch on account existence.
    assert responses[0] == responses[1] == responses[2]
    assert len(invites_sent) == 3
