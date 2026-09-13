# Care Infrastructure Application

J.W.T — "Speak your problem. We'll turn it into something your family or a helpline can actually act on."

A voice-first tool for adults 65+: the primary user speaks an issue, AI turns it into a reviewable summary, and the user sends it to a trusted contact or reaches a pre-loaded helpline. See `J.W.T — Product Specification.pdf` for the full spec.

## Stack

- **Backend:** Python 3 + FastAPI, JWT auth, SQLAlchemy 2.0 async + asyncpg
- **Frontend:** React + Vite
- **Database:** Postgres
- **LLM:** Google Gemini (`gemini-3.1-flash-lite`) via `google-generativeai`
- **Email:** Resend via `resend`
- **Deploy target:** Render

## Python differences to consider

**1. Pydantic schemas are a required extra layer.** In Express we wrote `if (!username) return res.status(400)` by hand in each controller. In FastAPI, you declare a Pydantic model for the request body and the framework validates it before your handler runs. Same idea for response bodies — declare the shape, FastAPI serializes it. This is the `server/schemas/` folder.

**2. `Depends()` replaces `app.use(middleware)` for per-route concerns.** The old `checkAuthentication` middleware becomes a function like `get_current_user`, and any route that needs auth pulls it in with `user = Depends(get_current_user)`. Cleaner than global middleware because it's obvious from the route signature which endpoints require auth and which don't. This is the `server/dependencies/` folder.

**3. snake_case in Python, camelCase in the API contract.** The DB and Python code use `full_name`, `has_completed_setup`. The JSON payloads use `fullName`, `hasCompletedSetup`. Pydantic handles the translation at the boundary with `alias_generator=to_camel` — you write one line of config on your schema and never touch it again.

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
│   │   └── helpline_model.py             # helplines
│   │
│   ├── schemas/                          # Pydantic request/response models (the new layer vs Express)
│   │   ├── auth.py                       # RegisterIn, LoginIn, AuthOut
│   │   ├── user.py                       # UserOut, UserUpdate
│   │   ├── summary.py                    # DraftIn/Out, SummaryCreate/Out, SendIn/Out
│   │   ├── contact.py                    # ContactCreate/Update/Out
│   │   └── helpline.py                   # HelplineOut
│   │
│   ├── dependencies/                     # FastAPI Depends() — replaces middleware for per-route concerns
│   │   ├── auth.py                       # get_current_user, require_primary, require_contact
│   │   └── db.py                         # get_db — yields an AsyncSession per request
│   │
│   ├── core/
│   │   ├── security.py                   # password hashing (bcrypt) + JWT encode/decode
│   │   ├── ai.py                         # Gemini client + draft_summary(transcript, answers)
│   │   └── email.py                      # Resend client + send_summary_email(to, summary_text)
│   │
│   └── db/
│       ├── base.py                       # SQLAlchemy DeclarativeBase every model inherits from
│       ├── engine.py                     # async engine + AsyncSessionLocal factory
│       └── seed.py                       # creates tables via Base.metadata + inserts seed rows
│
└── frontend/                             # React + Vite app
    ├── package.json                      # dev/build/preview scripts + React/Vite deps
    ├── vite.config.js                    # proxies /api → http://localhost:8000
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
