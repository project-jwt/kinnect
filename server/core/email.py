# core/email.py — Resend client + the app's outbound email
#
# Five things live here — one sender per outbound email, plus a link builder
# for each of the two invitation directions:
#   send_summary_email        -> POST /api/summaries/:id/send
#   invite_signup_url         -> the link in a primary -> contact invitation
#   send_contact_invite_email -> POST /api/contacts, unregistered-email branch
#   primary_signup_url        -> the link in a contact -> primary invitation
#   send_primary_invite_email -> POST /api/invitations/primary
#
# The two directions are asymmetric on purpose: a contact invitation is stored
# (models/invite_model.py) so it can be listed, resent, and accepted, while a
# primary invitation is stateless — see routers/invitations.py for why.
#
# Same shape as core/ai.py: configure the SDK once at import, raise on failure
# and let the router translate that into a 502.
# The sender address comes from settings.email_sender: in production it's an
# address at our Resend-verified domain (projectjwt.marcylab.us); locally it
# falls back to Resend's sandbox sender.

import asyncio
import html
from urllib.parse import quote

import resend
from resend.exceptions import ResendError

from config import settings

resend.api_key = settings.resend_api_key

SENDER = settings.email_sender


class EmailSendError(Exception):
    """The email provider failed (API error, quota, network). The send route
    catches exactly this — anything else escaping this module is one of our
    bugs and should surface as a 500, not be logged as a Resend failure."""


async def send_summary_email(
    to_email: str,
    summary_text: str,
    from_name: str | None = None,
    attachments: list[dict] | None = None,
) -> None:
    """Email one summary to one trusted contact. Raises EmailSendError on any
    Resend/network failure — the send route catches and 502s, recording nothing.

    attachments (optional): the summary's photos, each a dict
    { filename, content (bytes), content_type }. They ride along as real email
    attachments; the body notes how many there are.

    The resend SDK is synchronous (blocking HTTP), so the call runs in a
    worker thread via asyncio.to_thread instead of blocking the event loop.
    """
    sender_label = from_name or "Someone you trust"
    attachments = attachments or []

    # summary_text is user content going into an HTML email: escape it, then
    # turn the draft's blank-line paragraph breaks into <p> blocks and the
    # single line breaks inside a paragraph into <br> (review: a med list
    # typed on three lines arrived as one run-on line).
    paragraphs = "".join(
        "<p>" + html.escape(part).replace("\n", "<br>") + "</p>"
        for part in summary_text.split("\n\n")
        if part.strip()
    )
    body = (
        f"<p>{html.escape(sender_label)} shared this summary with you:</p>"
        f"<blockquote>{paragraphs}</blockquote>"
    )
    if attachments:
        count = len(attachments)
        body += f"<p>{count} photo{'s' if count != 1 else ''} attached.</p>"

    params: resend.Emails.SendParams = {
        "from": SENDER,
        "to": [to_email],
        "subject": f"{sender_label} shared a summary with you",
        "html": body,
    }
    if attachments:
        # Resend's Attachment.content takes a list of byte-values (or base64);
        # list(bytes) gives exactly that, no encoding step.
        params["attachments"] = [
            {
                "filename": a.get("filename") or "photo",
                "content": list(a["content"]),
                "content_type": a["content_type"],
            }
            for a in attachments
        ]
    try:
        await asyncio.to_thread(resend.Emails.send, params)
    except ResendError as exc:
        # The SDK funnels every failure mode here — API rejections and
        # network errors alike (its transport wraps those as HttpClientError).
        raise EmailSendError(str(exc)) from exc


def invite_signup_url(email: str) -> str:
    """The link in an invite email: the SPA root with query params App.jsx
    reads on mount.

    Query params on "/" rather than a path like /register because the frontend
    has NO router — views are useState — so any other path would fall through
    to main.py's static catch-all and land the invitee on the home screen with
    no prefill.
    """
    base = settings.app_base_url.rstrip("/")
    return f"{base}/?invite=contact&email={quote(email)}"


async def send_contact_invite_email(
    to_email: str, from_name: str | None, signup_url: str
) -> None:
    """Ask an unregistered person to create a trusted-contact account.

    Deliberately carries NO summary content: this fires when a primary ADDS
    them, which is before any summary exists. Raises EmailSendError on any
    Resend/network failure, exactly like send_summary_email — the add route
    catches it and 502s, recording no invite.
    """
    inviter = from_name or "Someone"
    # inviter goes into HTML, so escape it (same rule as summary_text above).
    # The subject is not HTML and takes the raw value.
    safe_inviter = html.escape(inviter)
    body = (
        f"<p>{safe_inviter} would like to share health summaries with you "
        f"on J.W.T.</p>"
        f"<p>A trusted contact receives short written updates about how "
        f"someone is doing. To start receiving them, create a free trusted "
        f"contact account:</p>"
        f'<p><a href="{html.escape(signup_url, quote=True)}">'
        f"Create my trusted contact account</a></p>"
        f"<p>If you weren&rsquo;t expecting this, you can ignore this email.</p>"
    )

    params: resend.Emails.SendParams = {
        "from": SENDER,
        "to": [to_email],
        "subject": f"{inviter} would like to share health summaries with you",
        "html": body,
    }
    try:
        await asyncio.to_thread(resend.Emails.send, params)
    except ResendError as exc:
        raise EmailSendError(str(exc)) from exc


def primary_signup_url(invitee_email: str, contact_email: str) -> str:
    """The link in a REVERSE invitation (a contact inviting a primary).

    Query params on "/" for the same reason as invite_signup_url: the frontend
    has no router, so any other path falls through to main.py's static
    catch-all. Two params do work here — `email` prefills the register form
    (a typo produces an account that is silently unconnected), and `contact`
    rides through registration so the new primary lands on a pre-filled
    Add-a-contact form instead of having to retype an address from an email.
    """
    base = settings.app_base_url.rstrip("/")
    return (
        f"{base}/?invite=primary"
        f"&email={quote(invitee_email)}"
        f"&contact={quote(contact_email)}"
    )


async def send_primary_invite_email(
    to_email: str, from_name: str | None, from_email: str, signup_url: str
) -> None:
    """Ask someone to create a PRIMARY account and add the inviting contact.

    The mirror of send_contact_invite_email. Carries no health content — this
    fires before any connection exists, so there is nothing shared to leak.
    Raises EmailSendError on any Resend/network failure; the route catches it
    and 502s.
    """
    inviter = from_name or "Someone"
    # Both go into HTML, so both are escaped. The subject is not HTML and takes
    # the raw name (same rule as send_summary_email).
    safe_inviter = html.escape(inviter)
    safe_from_email = html.escape(from_email)
    body = (
        f"<p>{safe_inviter} would like to receive health summaries from you "
        f"on J.W.T.</p>"
        f"<p>J.W.T turns what you say about how you are doing into a short "
        f"written update and sends it to the people you choose. To use it, "
        f"create your own account:</p>"
        f'<p><a href="{html.escape(signup_url, quote=True)}">'
        f"Create my account</a></p>"
        f"<p>Once you are set up, add <strong>{safe_from_email}</strong> as one "
        f"of your trusted contacts, and {safe_inviter} will start receiving "
        f"your updates. The link above fills that address in for you.</p>"
        f"<p>If you weren&rsquo;t expecting this, you can ignore this email.</p>"
    )

    params: resend.Emails.SendParams = {
        "from": SENDER,
        "to": [to_email],
        "subject": f"{inviter} would like to receive health summaries from you",
        "html": body,
    }
    try:
        await asyncio.to_thread(resend.Emails.send, params)
    except ResendError as exc:
        raise EmailSendError(str(exc)) from exc
