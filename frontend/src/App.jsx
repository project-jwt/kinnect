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
import { parseInviteParams } from './utils';
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
  // Seeded from an invitation link so the invitee lands on a register form
  // with their email filled in and the contact role already chosen.
  const [invitePrefill, setInvitePrefill] = useState(null); // { email, role }
  // Carried from a primary invitation (?contact=…) across authentication: the
  // contact's address the new primary should add. Consumed in handleAuth.
  const [pendingContactEmail, setPendingContactEmail] = useState(null);
  // Set when someone arrives from an invitation and lands on the prefilled Add
  // form. Deliberately NOT derived from pendingContactEmail: that is cleared
  // one render after the contacts screen mounts, which would let the
  // first-login tutorial pop up over the very form the invitation exists to
  // prefill. hasCompletedSetup is untouched, so the tour simply runs on their
  // next visit — connect first, tutorial after.
  const [deferTutorial, setDeferTutorial] = useState(false);
  // Set when an invitation's intended role was not the role they registered
  // with, which silently breaks the connection — see handleAuth.
  const [roleMismatch, setRoleMismatch] = useState(null);
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

  // An invitation link is ?invite=contact&email=… (a primary invited a trusted
  // contact) or ?invite=primary&email=…&contact=… (a contact invited a primary)
  // on the app root — query params, not a path, because there's no router here
  // and any other path falls through to the server's static catch-all. The
  // parsing itself lives in utils.parseInviteParams so it can be unit-tested.
  //
  // Runs after the stored-token check rather than on mount, because whether to
  // act depends on `user`, which isn't known until then.
  useEffect(() => {
    if (checking) return; // `user` is still unknown
    const invite = parseInviteParams(window.location.search);
    if (!invite) return;
    // Only consume the link when NOBODY is logged in. An already-authenticated
    // visitor (shared device, or an invitee who is also a primary here) never
    // reaches the logged-out branch below that renders the prefilled register
    // form — so stripping the params for them would drop them on their own
    // dashboard with no explanation AND destroy the link, leaving nothing to
    // retry. Leaving the URL untouched means they can log out and click it
    // again. Logging them out for them, or offering to, is a product decision
    // nobody has made.
    if (user) return;
    setInvitePrefill({ email: invite.email, role: invite.role });
    // Only a primary invitation carries this; null for a contact invitation.
    setPendingContactEmail(invite.contactEmail);
    setAuthMode('register');
    setAuthView('auth');
    // Drop the params so a refresh (or a later login) doesn't re-open this.
    window.history.replaceState({}, '', window.location.pathname);
    // `user` is deliberately NOT a dependency: this decides once, when the
    // token check settles, and must not re-fire when someone later logs OUT
    // on a URL that still carries the params. Re-firing would auto-open the
    // prefilled register form the moment they logged out — a
    // logout-and-continue flow, which is a product decision nobody has made.
    // Their recovery is to click the link again, which reloads the app and
    // gets them here with no user.
    //
    // (No eslint-disable here: this project has no eslint config, so the
    // directive was inert. This comment is the real explanation — keep it if a
    // linter is ever added, and re-add the disable then rather than "fixing"
    // the dependency array.)
  }, [checking]);

  const handleAuth = (loggedInUser) => {
    setUser(loggedInUser);
    // A primary invitation carried the inviting contact's address. Land them on
    // the Add-a-contact form with it filled in, so the connection is one press
    // away instead of an address to retype out of an email.
    //
    // Keyed on AUTHENTICATION, not registration: someone who clicks the link
    // but already has an account logs in rather than registering, and the
    // prefilled form is just as useful to them. Gated on the primary role
    // because a contact has no trusted-contacts list — there would be no form
    // to open, so the address is dropped rather than navigating nowhere.
    if (pendingContactEmail && loggedInUser.role === 'primary') {
      setView('contacts');
      // Hold the first-login walkthrough back until they've had a chance to
      // press Add. The shell is rendered inert behind that modal, so leaving it
      // on would make the prefilled form not merely covered but unclickable.
      setDeferTutorial(true);
      return;
    }
    // They had an invitation but registered as the other role. Nothing can be
    // connected — two trusted contacts have no relationship to each other, and
    // a primary invited as a contact leaves the inviter's invitation pending —
    // so say so rather than dropping them on a screen that looks fine.
    if (invitePrefill && loggedInUser.role !== invitePrefill.role) {
      setRoleMismatch({ expected: invitePrefill.role, got: loggedInUser.role });
    }
    setView('home');
  };

  // One-shot: once the contacts screen has been rendered with the prefill, drop
  // it. Without this, every later visit to Contacts would reopen the Add form.
  useEffect(() => {
    if (view === 'contacts' && pendingContactEmail) setPendingContactEmail(null);
  }, [view, pendingContactEmail]);

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
        initialEmail={invitePrefill?.email || ''}
        initialRole={invitePrefill?.role || 'primary'}
        inviteRole={invitePrefill?.role || null}
      />
    );
  }

  const isPrimary = user.role === 'primary';

  // First-login walkthrough (spec §MVP 6): auto-opens once for a primary user
  // who hasn't completed setup. `replayOpen` reruns the same modal on demand
  // from Profile. Contacts have no onboarding (login → dashboard). The modal
  // is self-contained, so it no longer forces a particular view behind it.
  const firstRun = isPrimary && !user.hasCompletedSetup && !deferTutorial;
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
        // Set only when arriving from a primary invitation; opens the Add form
        // prefilled. Ignored by the other views.
        initialAddEmail={pendingContactEmail || undefined}
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
    content = isPrimary ? (
      primaryScreen
    ) : (
      <ContactDashboard
        user={user}
        // Backstop for someone who registered as a contact against an
        // invitation meant for a primary: the connection they were invited to
        // make cannot exist, and without this they'd see an ordinary empty
        // dashboard and assume it worked.
        roleMismatch={roleMismatch?.expected === 'primary' ? roleMismatch : null}
        onDismissRoleMismatch={() => setRoleMismatch(null)}
      />
    );
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
