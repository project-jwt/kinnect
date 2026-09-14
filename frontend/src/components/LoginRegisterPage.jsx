// Login/register screen (spec §MVP 1). One primary action per screen:
// the mode toggle swaps between a login form and a register form rather
// than showing both at once. On success the user object is lifted to App
// via onAuth — the JWT itself is already stored by the auth adapters.

import { useState } from 'react';
import { login, register } from '../adapters/auth-adapters';

export default function LoginRegisterPage({
  onAuth,
  initialMode = 'login',
  onBack,
  // Seeded from an invitation link (?invite=contact&email=…) so the invitee
  // doesn't retype the address the invite was sent to — acceptance matches on
  // email, so a typo here would silently fail to link them.
  initialEmail = '',
  initialRole = 'primary',
  // The role the invitation was for, when they arrived from an invitation
  // link. null for an ordinary signup, which is why the warning below can key
  // off it directly rather than needing a separate "came from a link" flag.
  inviteRole = null,
}) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register'
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState(initialRole); // 'primary' | 'contact'
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const result =
      mode === 'login'
        ? await login({ email, password })
        : await register({ email, password, fullName, role });

    setSubmitting(false);
    if (result.error) {
      setError(result.error.message); // backend message, e.g. "Invalid credentials"
      return;
    }
    onAuth(result.user);
  };

  return (
    <main className="auth-page">
      {onBack && (
        <button type="button" className="auth-back" onClick={onBack}>
          ← Back
        </button>
      )}
      <h1>Kinnect</h1>
      <p className="tagline">
        Speak your problem. We&apos;ll turn it into something your family or a
        helpline can actually act on.
      </p>

      <form onSubmit={handleSubmit} className="auth-form">
        {mode === 'register' && (
          <>
            {/* Role picker — two big buttons instead of a dropdown */}
            <fieldset className="role-picker">
              <legend>I am…</legend>
              <button
                type="button"
                className={role === 'primary' ? 'selected' : ''}
                onClick={() => setRole('primary')}
              >
                Here for myself
              </button>
              <button
                type="button"
                className={role === 'contact' ? 'selected' : ''}
                onClick={() => setRole('contact')}
              >
                A trusted contact
              </button>
            </fieldset>

            {/* Someone arriving from an invitation link can still switch the
                role, and picking the other one silently breaks the connection
                the invitation exists to make: two trusted contacts have no
                relationship to each other, and a primary registered against a
                contact invitation leaves the inviter's invitation pending
                forever. Warn at the moment of the choice — after the fact,
                the account already exists and the email is spent. */}
            {inviteRole && role !== inviteRole && (
              <p className="auth-warning" role="status" aria-live="polite">
                {inviteRole === 'primary'
                  ? 'That invitation was for setting up your own account. If you sign up as a trusted contact, you won’t be connected to the person who invited you.'
                  : 'That invitation was for becoming someone’s trusted contact. If you sign up here for yourself, you won’t be connected to the person who invited you.'}
              </p>
            )}

            <label>
              Full name
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
              />
            </label>
          </>
        )}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            // 8-char minimum is a rule for NEW passwords — don't block
            // existing accounts from logging in with a shorter one.
            minLength={mode === 'register' ? 8 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button type="submit" className="primary-action" disabled={submitting}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        className="mode-toggle"
        onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
      >
        {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
      </button>
    </main>
  );
}
