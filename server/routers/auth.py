# routers/auth.py — spec §Auth: the only two endpoints that exist BEFORE login,
# and the only two that mint tokens. Everything else in the API decodes them.
#
# Express equivalent: the auth controller — but notice how little is left in it.
# Validation lives in schemas, hashing/tokens in core/security, queries in the
# model, session plumbing in dependencies. Handlers are just the wiring.

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import create_access_token, hash_password
from dependencies.db import get_db
from models import invite_model, user_model
from schemas.auth import AuthOut, LoginIn, RegisterIn

# Like an express.Router(). main.py mounts this under /api -> /api/auth/*.
router = APIRouter(prefix="/auth", tags=["auth"])  # tags group it in the auto-docs

logger = logging.getLogger(__name__)


@router.post("/register", response_model=AuthOut, status_code=201)
async def register(body: RegisterIn, session: AsyncSession = Depends(get_db)):
    """POST /api/auth/register  { email, password, fullName, role } -> 201 { token, user }

    By the time this body runs, RegisterIn has already 422'd bad emails,
    bad roles, and missing fields. Only the duplicate-email rule is left,
    because it needs the database.
    """
    if await user_model.find_by_email(session, body.email):
        raise HTTPException(status_code=409, detail="Email already registered")

    try:
        user = await user_model.create(
            session,
            email=body.email,
            password_hash=hash_password(body.password),  # raw password dies here
            full_name=body.full_name,
            role=body.role,
        )
    except IntegrityError:
        # Race: two same-email registrations can both pass the check above; the
        # DB's UNIQUE constraint catches the loser — translate to the same 409.
        raise HTTPException(status_code=409, detail="Email already registered")

    # A brand-new contact may already have been invited by one or more primary
    # users. Convert those pending invites into real links now, so they show up
    # on the inviter's list as usable (un-greyed) without a second step.
    if user.role == "contact":
        try:
            await invite_model.accept_for_user(session, user)
        except Exception:
            # Deliberately swallowed: a stale or broken invite row must never
            # stop someone from creating an account. The account is already
            # committed; the inviter simply keeps seeing a pending invite,
            # which they can cancel and re-send.
            #
            # What makes swallowing actually safe is db/engine.py's
            # expire_on_commit=False. If accept_for_user died mid-commit, this
            # session needs a rollback before it can be used again — and with
            # the default expire_on_commit=True, `user`'s attributes would be
            # marked stale, so serializing AuthOut(user=user) below would
            # trigger a re-SELECT on that session and 500: the guard would fail
            # the very registration it exists to protect. The flag keeps the
            # already-loaded values readable, so no query happens here.
            logger.exception("accepting contact invites failed for user %s", user.id)

    # Newly registered = logged in: mint their first token right away.
    return AuthOut(token=create_access_token(user.id, user.role), user=user)


@router.post("/login", response_model=AuthOut)
async def login(body: LoginIn, session: AsyncSession = Depends(get_db)):
    """POST /api/auth/login  { email, password } -> 200 { token, user }

    validate_password returns None for BOTH unknown email and wrong password
    (deliberate — see the model), so this endpoint has exactly one failure
    response, per spec: 401 Invalid credentials.
    """
    user = await user_model.validate_password(session, body.email, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return AuthOut(token=create_access_token(user.id, user.role), user=user)
