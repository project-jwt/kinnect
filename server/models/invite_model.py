# models/invite_model.py — the contact_invites table + helpers.
#
# A pending invitation from a primary user to an email address that has NO
# account yet. Unlike TrustedContactLink, the far end is not a users row —
# that's the entire reason this is a separate table: links keep their "both
# ends are real users" invariant, so the summary-send authorization path
# (contact_model.is_contact_of) can never be reached by an invite.
#
# Accepted invites are KEPT, not deleted: the 24h rate-limit count in
# routers/contacts.py counts created rows, and deleting on acceptance would
# quietly hand an abuser a fresh allowance every time an invite landed.
#
# CANCELLED invites are kept for the same reason, and it matters more there:
# cancelling is user-initiated and unlimited, so a hard delete let one account
# loop add -> cancel -> add and send unbounded email (verified: 25 invitations
# from one account inside one window) with MAX_INVITES_PER_DAY none the wiser.
# So cancel is a SOFT delete — cancelled_at is stamped, the row stays, and
# count_recent keeps counting it. Everything that means "still live" (the
# _pending helpers, count_open, and the acceptance lookup) filters it out.

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base

# Direct submodule import, NOT `from models import contact_model`: models/__init__
# imports this module, so the `models` package is only half-initialized while
# this file executes and its attributes may not be set yet. Importing
# models.contact_model by path doesn't depend on that.
from models.contact_model import TrustedContactLink, is_contact_of


class ContactInvite(Base):
    __tablename__ = "contact_invites"

    # Python attribute `id`, DB column `invite_id` — same trick as User/Summary.
    id: Mapped[int] = mapped_column("invite_id", primary_key=True)

    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE")
    )

    # ALWAYS stored lowercased — the router normalizes before calling in here.
    # A plain UNIQUE on the stored value behaves identically on Postgres and on
    # the SQLite test DB; a lower(email) functional index would not.
    # index=True: the UNIQUE below covers (owner_id, email) with owner_id
    # LEADING, which doesn't serve a lookup by email alone. accept_for_user
    # does exactly that on EVERY registration (list_pending_for_email), so it
    # gets its own index rather than a scan.
    email: Mapped[str] = mapped_column(Text, index=True)

    # The labels the owner typed. They ride across onto the link at acceptance,
    # so the primary doesn't have to re-enter them.
    nickname: Mapped[str | None] = mapped_column(Text)
    relationship: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Bumped on every (re)send — the resend cooldown reads this, not created_at.
    last_sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # NULL while pending. Set (never deleted) when the invitee registers.
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # NULL while pending. Set (never deleted) when the OWNER cancels — the soft
    # delete described in the header. count_recent still counts the row, which
    # is the entire point; nothing else treats it as live.
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # One invite per (owner, email). A second invite to the same address is
    # either a 409 (still pending) or a revive (already accepted OR cancelled)
    # — see routers/contacts.py; it is never a second row.
    __table_args__ = (UniqueConstraint("owner_id", "email"),)


def as_utc(dt: datetime) -> datetime:
    """Normalize a timestamp read back out of the DB before comparing it to
    datetime.now(timezone.utc).

    DateTime(timezone=True) is TIMESTAMPTZ on Postgres and comes back AWARE,
    but SQLite (the test DB) has no such type and hands back a NAIVE value.
    Comparing naive to aware raises TypeError, so every read-then-compare goes
    through here. The comparisons themselves stay in Python rather than SQL for
    the same reason — a bound tz-aware parameter does not mean the same thing
    to both dialects.
    """
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


# ── Query helpers ────────────────────────────────────────────────────────────
# OWNERSHIP SCOPING, same rule as contact_model: single-record helpers AND
# owner_id into the WHERE, so another primary's invite_id returns the same None
# as a nonexistent one and the router 404s both identically. The "_pending"
# helpers additionally require accepted_at IS NULL AND cancelled_at IS NULL —
# once accepted the durable record is the link, edited through
# /api/contacts/{linkId}; once cancelled there is nothing left to act on.


async def list_pending_by_owner(
    session: AsyncSession, owner_id: int
) -> list[ContactInvite]:
    """One primary's still-pending invites, oldest first — the tail of
    GET /api/contacts."""
    result = await session.execute(
        select(ContactInvite)
        .where(
            ContactInvite.owner_id == owner_id,
            ContactInvite.accepted_at.is_(None),
            ContactInvite.cancelled_at.is_(None),
        )
        .order_by(ContactInvite.created_at, ContactInvite.id)
    )
    return list(result.scalars().all())


async def find_any(
    session: AsyncSession, owner_id: int, email: str
) -> ContactInvite | None:
    """Any invite for this (owner, email) — pending, accepted OR cancelled.

    Deliberately not pending-only: the UNIQUE covers all three states, so the
    add route has to see a non-pending row to revive it instead of colliding.
    """
    result = await session.execute(
        select(ContactInvite).where(
            ContactInvite.owner_id == owner_id,
            ContactInvite.email == email,
        )
    )
    return result.scalar_one_or_none()


async def find_pending(
    session: AsyncSession, invite_id: int, owner_id: int
) -> ContactInvite | None:
    """One still-pending invite, only if owner_id owns it."""
    result = await session.execute(
        select(ContactInvite).where(
            ContactInvite.id == invite_id,
            ContactInvite.owner_id == owner_id,
            ContactInvite.accepted_at.is_(None),
            ContactInvite.cancelled_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def create(
    session: AsyncSession,
    owner_id: int,
    email: str,
    nickname: str | None,
    relationship: str | None,
) -> ContactInvite:
    """Insert an invite. email MUST already be lowercased by the caller.
    Raises IntegrityError on a duplicate (owner_id, email) — the router maps
    that race to the same 409 as the checked case."""
    invite = ContactInvite(
        owner_id=owner_id,
        email=email,
        nickname=nickname,
        relationship=relationship,
    )
    session.add(invite)
    await session.commit()
    # server_default timestamps are DB-generated, so re-read them: without this
    # created_at/last_sent_at are still None in Python and the cooldown check
    # would raise.
    await session.refresh(invite)
    return invite


async def revive(
    session: AsyncSession,
    invite: ContactInvite,
    nickname: str | None,
    relationship: str | None,
) -> ContactInvite:
    """Re-open a non-pending (accepted OR cancelled) invite as a fresh one.

    Reached two ways, both of which leave a kept row owning the UNIQUE while
    the email itself has no account, so the add route takes the invite branch:
      - accepted, then they deleted their account (cascading the link away)
        and the primary adds them again;
      - cancelled, and the primary changes their mind.
    Reviving keeps that constraint simple — no partial index, which SQLite and
    Postgres would not share — and keeps created_at meaning "when the invite
    currently on screen was sent", which is what invitedAt shows.

    BOTH stamps are cleared: a revived row must be pending by every helper's
    definition, and clearing only one would leave it invisible to the list it
    is supposed to reappear in.
    """
    now = datetime.now(timezone.utc)
    invite.accepted_at = None
    invite.cancelled_at = None
    invite.created_at = now
    invite.last_sent_at = now
    invite.nickname = nickname
    invite.relationship = relationship
    await session.commit()
    return invite


async def update_pending(
    session: AsyncSession, invite_id: int, owner_id: int, **fields
) -> ContactInvite | None:
    """Edit a pending invite's labels (PATCH /api/contacts/invites/:id). Only
    the fields passed get set, so an omitted nickname is left alone rather than
    nulled — same contract as contact_model.update."""
    invite = await find_pending(session, invite_id, owner_id)
    if invite is None:
        return None
    for name, value in fields.items():
        setattr(invite, name, value)
    await session.commit()
    return invite


async def touch_sent(session: AsyncSession, invite: ContactInvite) -> ContactInvite:
    """Stamp last_sent_at after a (re)send — the cooldown's only input."""
    invite.last_sent_at = datetime.now(timezone.utc)
    await session.commit()
    return invite


async def cancel_pending(
    session: AsyncSession, invite_id: int, owner_id: int
) -> bool:
    """Cancel a pending invite — a SOFT delete. True if cancelled, False if not
    found / not owned / already accepted or cancelled; the router turns False
    into 404.

    The row is STAMPED, not removed. Deleting it would have made the 24h send
    cap trivially bypassable (add, cancel, repeat) — see the module header.
    """
    invite = await find_pending(session, invite_id, owner_id)
    if invite is None:
        return False
    invite.cancelled_at = datetime.now(timezone.utc)
    await session.commit()
    return True


async def count_open(session: AsyncSession, owner_id: int) -> int:
    """How many invites this primary has waiting (the MAX_OPEN_INVITES cap).

    Cancelled rows are excluded: that cap is about how much is on screen
    awaiting a reply, and a cancelled invitation isn't waiting for anything.
    The daily cap (count_recent) is the one that keeps counting them.
    """
    result = await session.execute(
        select(func.count())
        .select_from(ContactInvite)
        .where(
            ContactInvite.owner_id == owner_id,
            ContactInvite.accepted_at.is_(None),
            ContactInvite.cancelled_at.is_(None),
        )
    )
    return result.scalar_one()


async def count_recent(
    session: AsyncSession, owner_id: int, cutoff: datetime
) -> int:
    """How many invites this primary CREATED since cutoff (the per-day cap).

    Counts accepted AND CANCELLED ones too — the cap is on outbound email
    volume, not on open invites, and letting either state reset the allowance
    would defeat it. Cancelling is the dangerous one, because the user does it
    themselves and can do it as often as they like: this deliberate absence of
    a cancelled_at filter is the only thing standing between one account and
    unlimited invitation email. Do not "tidy" a filter in here.

    The count happens in Python rather than in the WHERE clause on purpose:
    see as_utc — a tz-aware bound parameter does not compare the same way on
    Postgres and SQLite. One primary's invite rows are a tiny set, so loading
    the timestamps costs nothing.
    """
    result = await session.execute(
        select(ContactInvite.created_at).where(ContactInvite.owner_id == owner_id)
    )
    return sum(1 for (created,) in result.all() if as_utc(created) > cutoff)


async def list_pending_for_email(
    session: AsyncSession, email: str
) -> list[ContactInvite]:
    """Every primary's pending invite to this address — the acceptance lookup.
    email MUST already be lowercased by the caller.

    Cancelled rows are excluded, and that is load-bearing rather than tidiness:
    without the filter, registering would convert an invitation the primary
    explicitly withdrew into a real link, contradicting what the cancel screen
    promises ("They will not be able to join from the email we sent").
    """
    result = await session.execute(
        select(ContactInvite).where(
            ContactInvite.email == email,
            ContactInvite.accepted_at.is_(None),
            ContactInvite.cancelled_at.is_(None),
        )
    )
    return list(result.scalars().all())


async def accept_for_user(session: AsyncSession, user) -> int:
    """Turn every pending invite addressed to this newly-registered contact
    into a real trusted_contact_link. Returns how many were accepted.

    Called from POST /api/auth/register. Two things it must not do:
      - It must not raise on an ALREADY-LINKED pair. That happens when someone
        was linked, deleted their account, and re-registered while an invite
        was pending; the UNIQUE (owner_id, contact_id) would otherwise blow up
        mid-registration. Skip the insert, still stamp the invite.
      - It must not leave a half-done conversion visible: links and stamps
        commit together, in one transaction.
    """
    invites = await list_pending_for_email(session, user.email.lower())
    now = datetime.now(timezone.utc)
    for invite in invites:
        if not await is_contact_of(session, invite.owner_id, user.id):
            session.add(
                TrustedContactLink(
                    owner_id=invite.owner_id,
                    contact_id=user.id,
                    nickname=invite.nickname,
                    relationship=invite.relationship,
                )
            )
        invite.accepted_at = now
    await session.commit()
    return len(invites)
