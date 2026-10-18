import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiRequestError } from '../api/client';

const accounts = [
  { email: 'alex@opsdesk.local', label: 'Alex Morgan · Operations admin' },
  { email: 'blair@opsdesk.local', label: 'Blair Chen · Payments admin' },
  { email: 'casey@opsdesk.local', label: 'Casey Patel · Operations member' },
  { email: 'devon@opsdesk.local', label: 'Devon Kim · Payments member' },
  { email: 'emery@opsdesk.local', label: 'Emery Singh · Trust member' },
  { email: 'frankie@opsdesk.local', label: 'Frankie Rivera · Trust member' },
  { email: 'gray@opsdesk.local', label: 'Gray Johnson · Viewer' },
  { email: 'harper@opsdesk.local', label: 'Harper Brooks · Team admin' },
];

export function Login({
  onLogin,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'Sign in could not be completed. Please retry.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <a className="brand login-brand" href="/" aria-label="OpsFlow home">
          <span className="brand-mark">O</span>
          <span>OpsFlow</span>
        </a>
        <p className="eyebrow">INTERNAL OPERATIONS</p>
        <h1>Work with the full picture.</h1>
        <p className="login-copy">
          Bring requests, ownership, decisions, and next steps into one shared workspace.
        </p>
        <form className="form-stack login-form" onSubmit={submit}>
          <label>
            <span>Email</span>
            <input
              autoComplete="username"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="button button-primary button-wide" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {import.meta.env.DEV && (
          <details className="demo-accounts">
            <summary>Seeded demo accounts</summary>
            <p>
              Local demo accounts use the development password <code>nk10nikhil</code>.
            </p>
            <ul>
              {accounts.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword('nk10nikhil');
                    }}
                  >
                    {account.label}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <aside className="login-aside" aria-label="OpsFlow capabilities">
        <div className="aside-orbit orbit-one" />
        <div className="aside-orbit orbit-two" />
        <p className="aside-label">OPS FLOW / LIVE WORKSPACE</p>
        <div className="aside-card">
          <div className="aside-card-top">
            <span className="status status-in_progress">In progress</span>
            <span className="priority priority-urgent">Urgent</span>
          </div>
          <h2>Payment settlement mismatch</h2>
          <p>Assigned to Casey Patel · Payments</p>
          <div className="aside-progress">
            <span />
          </div>
          <div className="aside-event">
            <span className="timeline-dot" />
            <span>Ownership updated</span>
            <time>10:42 AM</time>
          </div>
        </div>
        <p className="aside-caption">
          Clear handoffs. A shared history. Every next step accounted for.
        </p>
      </aside>
    </main>
  );
}
