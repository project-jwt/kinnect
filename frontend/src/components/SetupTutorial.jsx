// SetupTutorial — first-login walkthrough (spec §MVP 6), a self-contained
// modal carousel. Each slide teaches one part of the app with a short bit of
// text and an illustration (image/GIF); it does not point at live elements,
// so it survives layout changes and can run on top of any screen.
//
// Opened two ways (see App.jsx):
//   • firstRun — auto-opens once for a primary user who hasn't finished setup.
//     Skip or Done calls markSetupComplete() so it won't auto-open again.
//   • replay  — re-opened on demand from Profile. Already complete, so closing
//     just dismisses it (no redundant PATCH).
//
// props:
//   firstRun  — true on the first-login run (persist completion), false on replay.
//   onFinish() — App's callback that flips hasCompletedSetup locally (first run)
//                and/or closes the modal.

import { useLayoutEffect, useRef, useState } from 'react';
import { markSetupComplete } from '../adapters/users-adapters';
import './SetupTutorial.css';

// Slides in tour order. `image` is a path under /public/tutorial (served at
// the site root); a slide with no image is a plain text card. The copy is kept
// short and literal for the 65+ audience, and names the on-screen labels the
// user will actually tap (Speak / History / Contacts / Helpline / Profile).
const SLIDES = [
  {
    id: 'welcome',
    title: 'Welcome to Kinnect',
    body: 'This app helps you share how you’re doing with the people who care about you. Here’s a quick look around.',
  },
  {
    id: 'speak',
    image: '/tutorial/speak.gif',
    title: 'Speak is your home screen',
    body: 'This is the first thing you’ll see. Press the big button and just talk — the app listens and writes down what you say.',
  },
  {
    id: 'review',
    image: '/tutorial/review.gif',
    title: 'Check it, then share',
    body: 'We turn your words into a short summary. Read it over, change anything you like, then choose who to send it to.',
  },
  {
    id: 'history',
    image: '/tutorial/history.gif',
    title: 'Look back anytime',
    body: 'Tap History at the bottom to read the updates you’ve shared before.',
  },
  {
    id: 'contacts',
    image: '/tutorial/contacts.gif',
    title: 'Your trusted people',
    body: 'Tap Contacts to see the family and friends who receive your updates.',
  },
  {
    id: 'helpline',
    image: '/tutorial/helpline.gif',
    title: 'Help is always here',
    body: 'If you ever need to talk to someone right away, tap Helpline.',
  },
  {
    id: 'nav',
    image: '/tutorial/nav.gif',
    title: 'Finding your way',
    body: 'The bar at the bottom — Speak, History, Contacts, Helpline — stays with you on every screen. Tap Speak any time to come back here.',
  },
  {
    id: 'profile',
    image: '/tutorial/profile.gif',
    title: 'Your account',
    body: 'Tap Profile at the top to update your name, email, or password.',
  },
  {
    id: 'finish',
    title: 'You’re all set',
    body: 'That’s everything. You can see this guide again anytime from Profile.',
  },
];

export default function SetupTutorial({ firstRun = false, onFinish }) {
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  // Per-slide image load failure → show the placeholder box instead. Reset on
  // every slide change (below) so one missing asset doesn't hide later ones.
  const [mediaError, setMediaError] = useState(false);
  const cardRef = useRef(null);
  const primaryButtonRef = useRef(null);

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  // New slide: reset the image-error flag and move focus to the primary
  // button. Focusing the freshly-rendered dialog control also announces the
  // slide to screen readers, so no aria-live region is needed. preventScroll
  // stops the browser from scrolling the (inert) page behind the modal to
  // bring the focused button into view — a replay from a scrolled Profile
  // page would otherwise jump the background and offset the overlay.
  useLayoutEffect(() => {
    setMediaError(false);
    primaryButtonRef.current?.focus({ preventScroll: true });
  }, [index]);

  // Close the tour. On the first-login run this persists completion so it
  // won't auto-open again; a replay is already complete, so it just closes.
  const finish = async () => {
    setSaving(true); // disables the buttons — no double PATCH / double close
    if (firstRun) {
      const { error } = await markSetupComplete();
      // Close even on error: the flag just stays false and the tour re-shows
      // next login, which beats leaving the user stuck on an undismissable modal.
      if (error) console.error('Could not save setup completion:', error);
    }
    onFinish();
  };

  // Tab wraps across the card's buttons. The app shell is inert while the tour
  // runs (App.jsx), so this is only wrap-around comfort — without it, Tab from
  // the last button detours through browser chrome.
  const trapFocus = (event) => {
    if (event.key !== 'Tab') return;
    const buttons = cardRef.current.querySelectorAll('button:not(:disabled)');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="tutorial-overlay" role="presentation">
      <div
        ref={cardRef}
        className="tutorial-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        onKeyDown={trapFocus}
      >
        <button
          type="button"
          className="tutorial-skip"
          onClick={finish}
          disabled={saving}
        >
          {firstRun ? 'Skip' : 'Close'}
        </button>

        {/* Fixed-ratio media slot. Falls back to a labelled placeholder while
            the real illustration for a slide is still missing. */}
        <div className="tutorial-media">
          {slide.image && !mediaError ? (
            <img
              className="tutorial-media__img"
              src={slide.image}
              alt=""
              onError={() => setMediaError(true)}
            />
          ) : (
            <div className="tutorial-media__fallback" aria-hidden="true">
              Illustration coming soon
            </div>
          )}
        </div>

        <h2 className="tutorial-title" id="tutorial-title">{slide.title}</h2>
        <p className="tutorial-body">{slide.body}</p>
        <p className="tutorial-progress">
          Step {index + 1} of {SLIDES.length}
        </p>

        <div className="tutorial-buttons">
          {index > 0 && (
            <button
              type="button"
              onClick={() => setIndex((i) => i - 1)}
              disabled={saving}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className="tutorial-next"
            ref={primaryButtonRef}
            onClick={isLast ? finish : () => setIndex((i) => i + 1)}
            disabled={saving}
          >
            {isLast ? (firstRun ? 'Get started' : 'Done') : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
