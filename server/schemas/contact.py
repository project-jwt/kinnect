# schemas/contact.py — request/response shapes for §Trusted Contacts
# (Primary only).

from datetime import datetime
from typing import Literal

from pydantic import EmailStr

from schemas.base import CamelModel


class ContactCreate(CamelModel):
    """POST /api/contacts body: { contactEmail, nickname?, relationship? }

    The email does NOT need an account. The router looks it up and branches:
    a Contact account is linked immediately (status "active"); an email with
    no account at all is INVITED (status "invited") — it gets a signup link
    and a pending row. Only an email belonging to an account of the wrong
    role 404s."""

    contact_email: EmailStr
    nickname: str | None = None
    relationship: str | None = None


class ContactUpdate(CamelModel):
    """PATCH /api/contacts/:linkId body: { nickname?, relationship? }
    Both optional — only the fields actually sent get updated (the router
    uses exclude_unset to tell "omitted" apart from "set to null")."""

    nickname: str | None = None
    relationship: str | None = None


class ContactOut(CamelModel):
    """Response shape for every contacts endpoint, covering BOTH kinds of row:

      status "active"  -> a real link: linkId, contactId, fullName are set
      status "invited" -> a pending invitation: inviteId, invitedAt are set

    The two are one shape with a discriminator rather than two response models
    because GET /api/contacts returns them in a single list — the contacts
    screen and the recipient picker both render invited people inline, so
    splitting the response would only force the frontend to re-merge it.

    fullName is None for an invited person: they have not registered, so
    nobody has typed their name. Clients fall back to nickname, then email.
    """

    status: Literal["active", "invited"]

    # Active rows only.
    link_id: int | None = None
    contact_id: int | None = None
    full_name: str | None = None

    # Both kinds.
    email: str
    nickname: str | None = None
    relationship: str | None = None

    # Invited rows only. invited_at is the invite's created_at, which a revive
    # resets — so it always reads "when the invite on screen was sent".
    invite_id: int | None = None
    invited_at: datetime | None = None


class InviteUpdate(CamelModel):
    """PATCH /api/contacts/invites/:inviteId body: { nickname?, relationship? }
    Same exclude_unset contract as ContactUpdate — an omitted field is left
    alone, an explicit null clears it."""

    nickname: str | None = None
    relationship: str | None = None
