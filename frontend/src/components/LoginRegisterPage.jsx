// Login/register screen (spec §MVP 1). One primary action per screen:
// the mode toggle swaps between a login form and a register form rather
// than showing both at once. On success the user object is lifted to App
// via onAuth — the JWT itself is already stored by the auth adapters.

import { useState } from 'react';
import { login, register } from '../adapters/auth-adapters';

export default function LoginRegisterPage({ onAuth, initialMode = 'login', onBack }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('primary'); // 'primary' | 'contact'
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
