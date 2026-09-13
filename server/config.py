# config.py — loads and validates environment variables from server/.env
#
# Express equivalent:
#     require('dotenv').config();
#     const secret = process.env.JWT_SECRET;   // undefined if missing — silent bug
#
# pydantic-settings improves on that in two ways:
#   1. Required fields (no default) crash the app AT STARTUP with a clear error
#      if the env var is missing, instead of failing later mid-request.
#   2. Values are converted to real types — jwt_expire_minutes arrives as an int,
#      not the string process.env would give you.

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Tells pydantic-settings to read a .env file in the working directory
    # (server/). Real environment variables (like on Render) take priority
    # over the file, so deploys don't need a .env at all.
    model_config = SettingsConfigDict(env_file=".env")

    # Field names match env vars case-insensitively: database_url <- DATABASE_URL.

    # Required — no default, so the app refuses to boot without them.
    database_url: str  # postgresql+asyncpg://... (+asyncpg picks the async driver)
    jwt_secret: str    # signs every token; leaking it = anyone can forge logins
    resend_api_key: str  # email-send is live — a blank key would boot fine but
                         # fail every send with a confusing 502, so require it

    # Optional — sensible defaults for local dev.
    jwt_algorithm: str = "HS256"       # HMAC-SHA256, the standard symmetric JWT alg
    jwt_expire_minutes: int = 60 * 24 * 7  # tokens live 7 days, then the user logs in again

    # The address summaries are sent FROM. In production this MUST be an
    # address at a Resend-verified domain (projectjwt.marcylab.us), set in
    # .env / the Render dashboard. Defaults to Resend's sandbox sender so local
    # dev and CI boot with no extra setup — but the sandbox only delivers to
    # the account owner, so real recipients need the verified-domain value.
    email_sender: str = "Kinnect <onboarding@resend.dev>"

    # Blank works until the AI-draft route is called — it 502s per request
    # without a key, which is visible enough for a dev-only feature gap.
    gemini_api_key: str = ""

    # Deepgram speech-to-text, used only by the audio-transcription route
    # (iOS / browsers without the Web Speech API). Blank is fine: the route
    # 502s without it and the frontend falls back to typing, so the app still
    # boots and every other feature works. Get a free key at deepgram.com.
    deepgram_api_key: str = ""


# Instantiated ONCE at import time — this line is what actually reads .env and
# validates. Every other file just does `from config import settings`.
settings = Settings()
