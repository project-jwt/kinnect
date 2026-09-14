# Kinnect

> "Speak your problem. We'll turn it into something your family or a helpline can actually act on."

Banking, healthcare, and even everyday errands have moved into apps and websites that are confusing to navigate, and scammers know it. When something feels wrong, many older adults freeze: they aren't sure what happened, who to ask, or how to explain it. Kinnect was created to remove that barrier. Instead of a chatbot or a maze of screens, the user presses one button and says what's going on in their own words.

Kinnect is a voice-first app for two kinds of users:

- **Primary users** — adults 65+ who need help. They speak an issue, the app asks guiding questions if something important is missing, and AI turns it into a clear, editable summary they can send to someone they trust or bring to a pre-loaded helpline.
- **Trusted Contacts** — family members or close friends who receive those summaries by email and in their own dashboard, so they can step in quickly with the full picture.

## MVPs

MVP (80/20) → User/Trusted Contacts (family or close friends)

1. As a User, I can login/register as either a "Primary" or a "Contact", manage my account, and can see my respective view (Primary/Contact).
2. As a User, I can utilize speech to text by pressing a single button to provide a summary of what their issues are to the app. If not enough context is given, the app will ask guiding questions. An AI-generated summary can be chosen to be given to trusted contacts as an email notification.
3. The user can edit the summary before or after it is sent, see a list of past summaries, and delete a summary.
4. As a User, I can reach pre-loaded helplines for assistance in scam identification (877-908-3360 AARP helpline Mon-Fri 8am to 8pm ET).
5. As a Primary user, I can see a list of my trusted contacts, add them by email, edit their nickname and relationship, and remove them.
6. As a User, I can see a Setup page at initial login informing me what the app is for and a tutorial on how to use it.

### Stretch Features

1. The setup page will have links to different sources about scams.
2. As a trusted contact, I receive a periodic digest notification in their preferred language through the app summarizing the user's flagged issues, instead of a live activity feed so I can stay informed without it feeling like surveillance.
3. As a User, I can select different languages to accommodate my needs (popup on first start so the user can immediately understand the interface) and have the option to change language within the app as well.

## Tech Stack

- **Frontend:** React 18 + Vite 5
- **Backend:** Python 3.11+ / FastAPI, Pydantic + pydantic-settings
- **Database:** PostgreSQL via SQLAlchemy 2.0 (async) + asyncpg
- **Auth:** JWT (`python-jose`) + bcrypt password hashing (`passlib`)
- **AI summaries:** Google Gemini (`gemini-3.1-flash-lite`) via `google-generativeai`
- **Speech-to-text:** browser Web Speech API on desktop; on mobile/iOS the app records with MediaRecorder and transcribes with Deepgram (`nova-2`)
- **Email:** Resend
- **Testing:** pytest + pytest-asyncio + httpx + aiosqlite (server); `node --test` (frontend)
- **Deploy:** Render — a single service where FastAPI serves the API under `/api` and the built `frontend/dist`

## Local development

Prerequisites: Python 3.11+, Node 18+, and Postgres running locally.

### Backend

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # then fill in DATABASE_URL, JWT_SECRET, RESEND_API_KEY, GEMINI_API_KEY, and DEEPGRAM_API_KEY
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

## File Structure

```
care-infrastructure/
├── .github/
│
├── frontend/                 # React + Vite app
│   ├── public/               # static assets served as-is
│   │   └── tutorial/         # illustrations for the setup tutorial slides - not added yet
│   └── src/
│       ├── adapters/         # fetch wrappers — one file per API resource
│       ├── components/       # screens and their styles
│       ├── hooks/            # speech recognition + audio transcription hooks
│       └── utils/            # small shared helpers (and their tests)
│
└── server/                   # FastAPI app
    ├── core/                 # security, AI (Gemini), email (Resend), transcription (Deepgram)
    ├── db/                   # declarative base, async engine, seed data
    ├── dependencies/         # FastAPI Depends() — auth guards, DB session
    ├── models/               # SQLAlchemy models + query helpers
    ├── routers/              # HTTP handlers under /api — one file per resource
    ├── schemas/              # Pydantic request/response models
    └── tests/                # pytest suite
```
