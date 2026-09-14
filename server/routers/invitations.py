# routers/invitations.py — invitations that a TRUSTED CONTACT sends.
#
# The mirror of the primary -> contact flow in routers/contacts.py, and
# deliberately NOT part of that router: /api/contacts is definitionally the
# PRIMARY's list and every route there is require_primary, so hanging a
# contact-only action off it would mislead the next reader.
#
# STATELESS on purpose (spec decision): this sends an email and returns.
# Nothing is recorded, which means:
#   - there is nothing to accept, cancel, or resend, so this router has exactly
#     one route (contrast the four in contacts.py);
#   - there are no per-contact rate limits, because there is nothing to count.
#     That is an accepted tradeoff, documented in the spec — the forward
#     direction's caps have no equivalent here;
#   - no account lookup happens, so the response cannot vary by whether the
#     address is registered. This direction therefore has none of the
#     email-enumeration exposure the forward direction accepts.

import logging

from fastapi import APIRouter, Depends, HTTPException

from core.email import EmailSendError, primary_signup_url, send_primary_invite_email
from dependencies.auth import require_contact
from models.user_model import User
from schemas.invitation import PrimaryInviteIn

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/invitations", tags=["invitations"])


@router.post("/primary")
async def invite_primary(
    body: PrimaryInviteIn,
    user: User = Depends(require_contact),
):
    """POST /api/invitations/primary  { email } -> 200 { message }

    A trusted contact invites someone to create a primary account and add them.
    require_contact means a primary-role token gets 403 before this body runs.

    Note there is no get_db: nothing is written and nothing is read. The address
    is used exactly as EmailStr validated it — the forward direction lowercases
    because it stores and later matches on the value, and here there is neither.
    """
    try:
        await send_primary_invite_email(
            body.email,
            from_name=user.full_name,
            from_email=user.email,
            signup_url=primary_signup_url(body.email, user.email),
        )
    except EmailSendError:
        # Provider outage/quota/network — same treatment as every other
        # outbound-email route: log the real error, send a generic 502.
        logger.exception("send_primary_invite_email failed")
        raise HTTPException(
            status_code=502,
            detail="Could not send the invitation right now — please try again",
        )
    return {"message": "Invitation sent"}
