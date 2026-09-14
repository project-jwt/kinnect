# Care Infrastructure Application

Kinnect — "Speak your problem. We'll turn it into something your family or a helpline can actually act on."

A voice-first tool for adults 65+: the primary user speaks an issue, AI turns it into a reviewable summary, and the user sends it to a trusted contact or reaches a pre-loaded helpline. See `Kinnect — Product Specification.pdf` for the full spec.

## Stack

- **Backend:** Python 3 + FastAPI, JWT auth, SQLAlchemy 2.0 async + asyncpg
- **Frontend:** React + Vite
- **Database:** Postgres
- **LLM:** Google Gemini (`gemini-3.1-flash-lite`) via `google-generativeai`
- **Email:** Resend via `resend`
- **Deploy target:** Render

## Local development

Prerequisites: Python 3.11+, Node 18+, and Postgres running locally.

### Backend

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # then fill in DATABASE_URL, JWT_SECRET, and RESEND_API_KEY
createdb care_infrastructure     # or create the database named in your DATABASE_URL

uvicorn main:app --reload --port 8000
```

Tables are created automatically on startup — no migration step. The API is at `http://127.0.0.1:8000/api`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL it prints (`http://localhost:5173`). The dev server proxies every `/api` request to `127.0.0.1:8000`, so the browser talks to a single origin and no CORS setup is needed — but it also means the backend must be running for the app to work.

## Python differences to consider

**1. Pydantic schemas are a required extra layer.** In Express we wrote `if (!username) return res.status(400)` by hand in each controller. In FastAPI, you declare a Pydantic model for the request body and the framework validates it before your handler runs. Same idea for response bodies — declare the shape, FastAPI serializes it. This is the `server/schemas/` folder.

**2. `Depends()` replaces `app.use(middleware)` for per-route concerns.** The old `checkAuthentication` middleware becomes a function like `get_current_user`, and any route that needs auth pulls it in with `user = Depends(get_current_user)`. Cleaner than global middleware because it's obvious from the route signature which endpoints require auth and which don't. This is the `server/dependencies/` folder.

**3. snake_case in Python, camelCase in the API contract.** The DB and Python code use `full_name`, `has_completed_setup`. The JSON payloads use `fullName`, `hasCompletedSetup`. Pydantic handles the translation at the boundary with `alias_generator=to_camel` — you write one line of config on your schema and never touch it again.

## Team workflow

Branches: `pre-prod` is the integration branch — all feature PRs target it. `main` is the stable branch — it only receives promotion PRs from `pre-prod` and is what Render deploys.

1. Move your assigned ticket to **In Progress** on the board.
2. Branch from fresh `pre-prod`: `git checkout pre-prod && git pull && git checkout -b your-name/feature-name`.
3. Use [Conventional Commits](https://www.conventionalcommits.org): `feat: …`, `fix: …`, `docs: …`, `chore: …` — with an optional scope like `feat(server): …`.
4. Open the PR early **to `pre-prod`** (draft is fine), fill out the template, move the ticket to **In Review**.
5. Tag one teammate for review. Reviews are substantive: ask about unclear code, flag potential breaks, suggest improvements. Reviews are due within 24 hours — anything older gets raised in the daily stand-down.
6. Reviewer approves → author merges (merge commit) and deletes the branch; ticket to **Done**.
7. Promotion: when `pre-prod` is stable (at minimum before each deploy milestone), open a PR from `pre-prod` → `main`. `main` must always run; every merge to `main` auto-deploys to Render — check the deploy after merging.
8. No direct pushes to `main` or `pre-prod` — branch protection blocks them, including for admins.

## File structure

```
care-infrastructure/
├── README.md
├── .gitignore                            # Python + Node ignores
├── LICENSE
│
├── server/                               # FastAPI app
│   ├── main.py                           # builds the FastAPI app and registers every router under /api
│   ├── config.py                         # Settings loaded from .env (DB url, JWT secret/alg/expiry, Gemini + Resend keys)
│   ├── requirements.txt                  # backend Python dependencies
│   │
│   ├── routers/                          # HTTP handlers — one file per resource (same idea as "controllers")
│   │   ├── auth.py                       # /api/auth/register, /api/auth/login
│   │   ├── users.py                      # /api/users/me, /api/users/me/setup
│   │   ├── summaries.py                  # /api/summaries/* (primary only)
│   │   ├── contacts.py                   # /api/contacts/*
│   │   ├── received_summaries.py         # /api/received-summaries (contact only)
│   │   └── helplines.py                  # /api/helplines
│   │
│   ├── models/                           # SQLAlchemy declarative models + async query helpers, one file per table group
│   │   ├── user_model.py                 # users table
│   │   ├── summary_model.py              # summaries + summary_recipients
│   │   ├── contact_model.py              # trusted_contact_links
│   │   ├── invite_model.py               # contact_invites — pending invitations to unregistered emails
│   │   └── helpline_model.py             # helplines
│   │
│   ├── schemas/                          # Pydantic request/response models (the new layer vs Express)
│   │   ├── auth.py                       # RegisterIn, LoginIn, AuthOut
│   │   ├── user.py                       # UserOut, UserUpdate
│   │   ├── summary.py                    # DraftIn/Out, SummaryCreate/Out, SendIn/Out
│   │   ├── contact.py                    # ContactCreate/Update/Out, InviteUpdate
│   │   └── helpline.py                   # HelplineOut
│   │
│   ├── dependencies/                     # FastAPI Depends() — replaces middleware for per-route concerns
│   │   ├── auth.py                       # get_current_user, require_primary, require_contact
│   │   └── db.py                         # get_db — yields an AsyncSession per request
│   │
│   ├── core/
│   │   ├── security.py                   # password hashing (bcrypt) + JWT encode/decode
│   │   ├── ai.py                         # Gemini client + draft_summary(transcript, answers)
│   │   └── email.py                      # Resend client + summary and contact-invitation emails
│   │
│   └── db/
│       ├── base.py                       # SQLAlchemy DeclarativeBase every model inherits from
│       ├── engine.py                     # async engine + AsyncSessionLocal factory
│       └── seed.py                       # creates tables via Base.metadata + inserts seed rows
│
└── frontend/                             # React + Vite app
    ├── package.json                      # dev/build/preview scripts + React/Vite deps
    ├── vite.config.js                    # proxies /api → http://127.0.0.1:8000
    ├── index.html                        # Vite entry HTML
    │
    └── src/
        ├── main.jsx                      # React root render
        ├── App.jsx                       # top-level auth state + role-based routing
        ├── App.css                       # global styles
        │
        ├── adapters/                     # fetch wrappers — one file per resource
        │   ├── fetch-helpers.js          # shared handleFetch + JWT header injection
        │   ├── auth-adapters.js          # register / login / logout
        │   ├── users-adapters.js         # getMe / updateMe / markSetupComplete
        │   ├── summaries-adapters.js     # draft / save / list / get / update / delete / send
        │   ├── contacts-adapters.js      # list / add / update / delete
        │   ├── received-summaries-adapters.js  # listReceivedSummaries
        │   └── helplines-adapters.js     # listHelplines
        │
        └── components/                   # one file per screen from the wireframe
            ├── LoginRegisterPage.jsx     # role picker + login/register
            ├── SetupTutorial.jsx         # first-login onboarding
            ├── PrimaryHome.jsx           # single "speak now" button
            ├── RecordingPage.jsx         # SpeechRecognition + clarifying-question loop
            ├── SummaryReview.jsx         # editable summary
            ├── ChooseAction.jsx          # send-to-contact or call-helpline
            ├── PastSummaries.jsx         # list + detail / edit / delete
            ├── TrustedContactsList.jsx   # add / edit / delete
            ├── HelplinePage.jsx          # AARP one-tap call
            ├── ContactDashboard.jsx      # read-only received summaries
            └── BottomNav.jsx             # 3-icon bottom nav
```
