# schemas/invitation.py — request shapes for invitations a TRUSTED CONTACT
# sends (routers/invitations.py).

from pydantic import EmailStr

from schemas.base import CamelModel


class PrimaryInviteIn(CamelModel):
    """POST /api/invitations/primary body: { email }.

    Just the address. The inviting contact comes from the token, and nothing is
    stored, so there are no labels (nickname/relationship) to carry the way
    ContactCreate has — there is no row for them to live on.
    """

    email: EmailStr
