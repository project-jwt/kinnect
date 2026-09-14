# tests/test_invite_email.py — the invite email's params and the signup link.
#
# These tests never reach Resend: they replace resend.Emails.send with a
# recorder and inspect the params dict the module builds.

import pytest

import resend
from core.email import EmailSendError, invite_signup_url, send_contact_invite_email


@pytest.fixture
def sent(monkeypatch):
    """Capture the params dict instead of calling Resend."""
    captured = []
    monkeypatch.setattr(resend.Emails, "send", lambda params: captured.append(params))
    return captured


async def test_invite_email_carries_the_link_and_names_the_inviter(sent):
    await send_contact_invite_email(
        "new@example.com", "Eleanor P.", "http://x/?invite=contact&email=new%40example.com"
    )
    assert len(sent) == 1
    params = sent[0]
    assert params["to"] == ["new@example.com"]
    assert "Eleanor P." in params["subject"]
    assert "Eleanor P." in params["html"]
    assert "http://x/?invite=contact&amp;email=new%40example.com" in params["html"]
    # An invite fires at ADD time, so there is no summary to leak into it.
    assert "attachments" not in params


async def test_invite_email_escapes_the_inviter_name(sent):
    await send_contact_invite_email("new@example.com", "<script>x</script>", "http://x/")
    assert "<script>" not in sent[0]["html"]
    assert "&lt;script&gt;" in sent[0]["html"]


async def test_invite_email_falls_back_when_the_name_is_missing(sent):
    await send_contact_invite_email("new@example.com", None, "http://x/")
    assert "Someone" in sent[0]["subject"]


async def test_invite_email_wraps_provider_failures(monkeypatch):
    def boom(params):
        raise resend.exceptions.ResendError(
            code=500, message="down", error_type="x", suggested_action="y"
        )

    monkeypatch.setattr(resend.Emails, "send", boom)
    with pytest.raises(EmailSendError):
        await send_contact_invite_email("new@example.com", "E", "http://x/")


def test_signup_url_encodes_the_email_and_survives_a_trailing_slash(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "app_base_url", "https://app.example.com/")
    url = invite_signup_url("a+b@example.com")
    assert url == "https://app.example.com/?invite=contact&email=a%2Bb%40example.com"
