// Public marketing landing page — the first screen a logged-out visitor
// sees. "Get started" and "Log in" both hand control back to App, which
// reveals LoginRegisterPage in the requested mode. Styled to match the main
// app's screens (deep-blue #1a5276, 34rem centered column, 0.5rem radius,
// grey-outlined cards) so it reads as the same application.

import './LandingPage.css';

export default function LandingPage({ onGetStarted, onLogin }) {
  return (
    <div className="landing">
      {/* Header — same logo + login affordance as the app shell */}
      <header className="landing__header">
        <span className="landing__logo">Kinnect</span>
        <button type="button" className="landing__login" onClick={onLogin}>
          Log in
        </button>
      </header>

      <main className="landing__main">
        {/* Hero */}
        <section className="landing__hero">
          <h1 className="landing__title">
            Speak your problem.
            <br />
            We&apos;ll turn it into something your family or a helpline can
            actually act on.
          </h1>
          <p className="landing__subtitle">
            When something feels wrong, you shouldn&apos;t have to fight with an
            app to get help. Kinnect gets you to a real person, family or a
            helpline, faster.
          </p>
          <button
            type="button"
            className="landing__cta"
            onClick={onGetStarted}
          >
            Get started
          </button>

          {/* Speak → Summary → Send visual (pure CSS shapes) */}
          <div className="landing__steps">
            <div className="landing__step">
              <div className="landing__step-icon">
                <div className="landing__shape-mic"></div>
              </div>
              <div className="landing__step-label">You speak</div>
            </div>
            <div className="landing__step-arrow" aria-hidden="true">
              →
            </div>
            <div className="landing__step">
              <div className="landing__step-icon">
                <div className="landing__shape-line landing__shape-line--1"></div>
                <div className="landing__shape-line landing__shape-line--2"></div>
                <div className="landing__shape-line landing__shape-line--3"></div>
              </div>
              <div className="landing__step-label">A clear summary</div>
            </div>
            <div className="landing__step-arrow" aria-hidden="true">
              →
            </div>
            <div className="landing__step">
              <div className="landing__step-icon">
                <div className="landing__shape-contact"></div>
              </div>
              <div className="landing__step-label">Sent to family</div>
            </div>
          </div>
        </section>

        {/* Why this exists */}
        <section className="landing__section">
          <h2 className="landing__h2">Getting help shouldn&apos;t be this hard</h2>
          <p className="landing__body">
            Banking, healthcare, even errands now happen through confusing apps
            and websites, and scammers know it. When something feels wrong, most
            people freeze: not sure who to call, not wanting to bother family
            over &quot;maybe nothing,&quot; and running out of time before it
            becomes a real problem.
          </p>
          <p className="landing__body">
            Kinnect skips the chatbot and the confusing screens. You just say
            what&apos;s going on, out loud, and it quietly does the work of
            turning that into something a real person can act on.
          </p>
        </section>

        {/* How it works */}
        <section className="landing__section">
          <h2 className="landing__h2">How it works</h2>
          <ul className="landing__cards">
            <li className="landing__card">
              <div className="landing__badge">1</div>
              <div className="landing__card-body">
                <p className="landing__card-title">Speak your problem</p>
                <p className="landing__card-desc">
                  Just talk, the same way you&apos;d tell a friend.
                  &quot;I&apos;ve received a suspicious call today.&quot;
                </p>
              </div>
            </li>
            <li className="landing__card">
              <div className="landing__badge">2</div>
              <div className="landing__card-body">
                <p className="landing__card-title">
                  We turn it into a clear summary
                </p>
                <p className="landing__card-desc">
                  You review it and make sure it says exactly what you mean,
                  before anything is sent.
                </p>
              </div>
            </li>
            <li className="landing__card">
              <div className="landing__badge">3</div>
              <div className="landing__card-body">
                <p className="landing__card-title">
                  Send it to family or a helpline
                </p>
                <p className="landing__card-desc">
                  One tap reaches a trusted contact or a pre-loaded helpline,
                  already set up for you.
                </p>
              </div>
            </li>
          </ul>
        </section>

        {/* Why families trust it */}
        <section className="landing__section">
          <h2 className="landing__h2">A faster way to reach a real person</h2>
          <ul className="landing__cards">
            <li className="landing__card">
              <div className="landing__check" aria-hidden="true">
                ✓
              </div>
              <div className="landing__card-body">
                <p className="landing__card-desc">
                  <strong className="landing__lead">
                    You&apos;re always in control.
                  </strong>{' '}
                  Every summary is reviewable, nothing sends until you approve
                  it.
                </p>
              </div>
            </li>
            <li className="landing__card">
              <div className="landing__check" aria-hidden="true">
                ✓
              </div>
              <div className="landing__card-body">
                <p className="landing__card-desc">
                  <strong className="landing__lead">
                    Contacts are easy to keep current.
                  </strong>{' '}
                  You or a trusted contact can add or update contacts and
                  helplines anytime from a shared dashboard, so it&apos;s never
                  out of date.
                </p>
              </div>
            </li>
            <li className="landing__card">
              <div className="landing__check" aria-hidden="true">
                ✓
              </div>
              <div className="landing__card-body">
                <p className="landing__card-desc">
                  <strong className="landing__lead">Built to be easy.</strong>{' '}
                  Large text, simple screens, and no technical know-how required.
                </p>
              </div>
            </li>
          </ul>
        </section>

        {/* Reassurance / safety note */}
        <section className="landing__section">
          <p className="landing__note">
            Every summary is reviewed by you before it&apos;s sent, and a
            helpline is always just one tap away.
          </p>
        </section>

        {/* Final CTA */}
        <section className="landing__section landing__section--cta">
          <h2 className="landing__h2">Ready to feel a little more supported?</h2>
          <button
            type="button"
            className="landing__cta"
            onClick={onGetStarted}
          >
            Get started
          </button>
        </section>
      </main>

      {/* Footer */}
      <footer className="landing__footer">© 2026 Kinnect</footer>
    </div>
  );
}
