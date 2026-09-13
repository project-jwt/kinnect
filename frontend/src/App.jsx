// App — top-level auth state + role-based view switching (no router; a
// `view` string decides which screen renders).
//
// How teammates plug a new screen in:
//   1. Add your component to the VIEWS map below with a view name.
//   2. Navigate to it from anywhere via the onNavigate prop (or BottomNav).
//   3. Need the logged-in user? Take it as a prop and pass it where App
//      renders your view.

import { useEffect, useState } from 'react';
import { getToken } from './adapters/fetch-helpers';
import { logout } from './adapters/auth-adapters';
import { getMe } from './adapters/users-adapters';
import LandingPage from './components/LandingPage';
import LoginRegisterPage from './components/LoginRegisterPage';
import SetupTutorial from './components/SetupTutorial';
import BottomNav from './components/BottomNav';
import RecordingPage from './components/RecordingPage';
import SummaryReview from './components/SummaryReview';
import ChooseAction from './components/ChooseAction';
import ContactDashboard from './components/ContactDashboard';
import PastSummaries from './components/PastSummaries';
import TrustedContactsList from './components/TrustedContactsList';
import HelplinePage from './components/HelplinePage';
import ProfilePage from './components/ProfilePage';

// Primary user's simple screens, keyed by view name (BottomNav's
// history/contacts/helpline). 'home' is the landing view — it renders the
// speak/record screen (see primaryScreen below) rather than living here,
// because that screen needs per-flow props the uniform map can't express.
const VIEWS = {
  history: PastSummaries,
  contacts: TrustedContactsList,
  helpline: HelplinePage,
};

export default function App() {
  const [user, setUser] = useState(null); // null = logged out
  const [checking, setChecking] = useState(true); // true while validating a stored token
  const [view, setView] = useState('home');
  // Pre-auth screen: logged-out visitors start on the marketing landing page,
  // then a CTA reveals the login/register form in the requested mode.
  const [authView, setAuthView] = useState('landing'); // 'landing' | 'auth'
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  // Carried from the recording step to the review step (speak → review flow):
  // the raw transcript and the AI-drafted summary the user will edit/approve.
  const [transcript, setTranscript] = useState('');
  const [summaryText, setSummaryText] = useState('');
  // The summary the choose-action step will send (what /:id/send needs).
  // Set on save (review step) or from History's send button; cleared when
  // the user navigates out of the flow so no stale id lingers.
  const [savedSummaryId, setSavedSummaryId] = useState(null);
  // True while ChooseAction has a send in flight — freezes BottomNav so the
  // request's outcome can't be lost to a mid-send navigation.
  const [navLocked, setNavLocked] = useState(false);
  // Set when the user re-opens the walkthrough from Profile — an on-demand
  // replay that runs the same modal without the first-login gate below.
  const [replayOpen, setReplayOpen] = useState(false);

  // On first load: if a token survived a refresh, ask the backend who it
  // belongs to. Only an explicit rejection (401/403 = expired, forged, user
  // deleted) clears the token — a network blip or server error keeps it, so
  // a valid session isn't lost to a temporary outage.
  useEffect(() => {
    const restoreSession = async () => {
      if (!getToken()) {
        setChecking(false);
        return;
      }
      const { data, error } = await getMe();
      if (error) {
        if (error.status === 401 || error.status === 403) logout();
      } else {
        setUser(data);
      }
      setChecking(false);
    };
    restoreSession();
  }, []);

  const handleAuth = (loggedInUser) => {
    setUser(loggedInUser);
    setView('home');
  };

  // The one navigation path handed to child screens: leaving for anywhere
  // but the choose-action flow drops the pending summary id, so no stale id
  // lingers behind a later visit.
  const navigate = (next) => {
    if (next !== 'choose-action') setSavedSummaryId(null);
    setView(next);
  };

  const handleLogout = () => {
    logout(); // clears the stored token
    setUser(null);
    setView('home');
    setAuthView('landing'); // logging out returns to the landing page, not the bare login form
  };

  // Don't flash the login page while we're still checking the stored token.
  if (checking) return <div className="app-loading">Loading…</div>;

  if (!user) {
    if (authView === 'landing') {
      return (
        <LandingPage
          onGetStarted={() => { setAuthMode('register'); setAuthView('auth'); }}
          onLogin={() => { setAuthMode('login'); setAuthView('auth'); }}
        />
      );
    }
    return (
      <LoginRegisterPage
        onAuth={handleAuth}
        initialMode={authMode}
        onBack={() => setAuthView('landing')}
      />
    );
  }

  const isPrimary = user.role === 'primary';

  // First-login walkthrough (spec §MVP 6): auto-opens once for a primary user
  // who hasn't completed setup. `replayOpen` reruns the same modal on demand
  // from Profile. Contacts have no onboarding (login → dashboard). The modal
  // is self-contained, so it no longer forces a particular view behind it.
  const firstRun = isPrimary && !user.hasCompletedSetup;
  const showTutorial = firstRun || replayOpen;

  // The speak → review → choose-action flow hands per-flow state between
  // steps (transcript, then the saved summary's id), which the uniform VIEWS
  // map (user/onNavigate only) can't express — so those screens render
  // explicitly. 'home' lands on the speak/record screen (the app's primary
  // action); unknown views fall through to it too.
  let primaryScreen;
  if (view === 'review') {
    primaryScreen = (
      <SummaryReview
        user={user}
        transcript={transcript}
        summaryText={summaryText}
        onSaved={(id) => {
          setSavedSummaryId(id);
          setView('choose-action');
        }}
        onNavigate={navigate}
      />
    );
  } else if (view === 'choose-action' && savedSummaryId != null) {
    // The null guard is defensive: a refresh mid-flow resets view to 'home'
    // anyway, and the saved summary is always waiting under History.
    primaryScreen = (
      <ChooseAction
        summaryId={savedSummaryId}
        onNavigate={navigate}
        onBusyChange={setNavLocked}
      />
    );
  } else if (VIEWS[view]) {
    const CurrentView = VIEWS[view];
    primaryScreen = (
      <CurrentView
        user={user}
        onNavigate={navigate}
        // History's per-summary send button re-enters the choose-action
        // flow with that summary's id (ignored by the other views).
        onSendSummary={(id) => {
          setSavedSummaryId(id);
          setView('choose-action');
        }}
      />
    );
  } else {
    // 'home' (and any unrecognised view) — the speak/record screen is the
    // landing view, so it has no Back button.
    primaryScreen = (
      <RecordingPage
        onContinue={({ transcript: nextTranscript, summaryText: nextSummary }) => {
          setTranscript(nextTranscript);
          setSummaryText(nextSummary);
          setView('review');
        }}
      />
    );
  }

  // The account dashboard is available to BOTH roles from the header, so it
  // wins over the role split below. onBack returns to 'home' — which for a
  // contact simply falls through to their ContactDashboard.
  let content;
  if (view === 'profile') {
    content = (
      <ProfilePage
        user={user}
        onUpdated={setUser}
        onBack={() => setView('home')}
        onDeleted={handleLogout}
        // Primaries can replay the walkthrough from here; contacts have none.
        onReplayTutorial={isPrimary ? () => setReplayOpen(true) : undefined}
      />
    );
  } else {
    // Contacts get one read-only screen; primaries get the view switcher.
    content = isPrimary ? primaryScreen : <ContactDashboard user={user} />;
  }

  return (
    <>
      {/* inert while the tour runs: the modal already blocks pointer events,
          but only inert keeps keyboard focus from Tabbing into the page
          underneath (Enter on Log out or a nav tab would act through the
          tour). '' not a boolean — React 18 renders `inert={false}` as a
          present (and therefore active) attribute. */}
      <div className="app-shell" inert={showTutorial ? '' : undefined}>
        <header className="app-header">
          <span className="app-title">Kinnect</span>
          <div className="app-header__actions">
            <button type="button" onClick={() => setView('profile')}>Profile</button>
            <button type="button" onClick={handleLogout}>Log out</button>
          </div>
        </header>

        <div className="app-content">{content}</div>

        {isPrimary && <BottomNav active={view} onNavigate={navigate} disabled={navLocked} />}
      </div>

      {/* Outside the shell so the inert above can't swallow the tour itself. */}
      {showTutorial && (
        <SetupTutorial
          firstRun={firstRun}
          onFinish={() => {
            // First run persists completion so it won't auto-open again; a
            // replay just closes (already complete — no redundant PATCH).
            if (firstRun) setUser((u) => ({ ...u, hasCompletedSetup: true }));
            setReplayOpen(false);
          }}
        />
      )}
    </>
  );
}
