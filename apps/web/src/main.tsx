import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiRequestError, fetchMe, login, logout, type Me } from './api/client';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { WorkItemDetail } from './pages/WorkItemDetail';
import './styles.css';

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [route, setRoute] = useState(`${window.location.pathname}${window.location.search}`);

  useEffect(() => {
    let active = true;
    const onPopState = () => setRoute(`${window.location.pathname}${window.location.search}`);
    window.addEventListener('popstate', onPopState);
    fetchMe().then((user) => { if (active) setMe(user); }).catch((cause: unknown) => {
      if (active && !(cause instanceof ApiRequestError && cause.status === 401)) {
        setSessionError(cause instanceof Error ? cause.message : 'Could not check your session.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener('popstate', onPopState); };
  }, []);

  function navigate(path: string, replace = false) {
    if (replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
    setRoute(`${window.location.pathname}${window.location.search}`);
  }

  async function signIn(email: string, password: string) {
    await login(email, password);
    setMe(await fetchMe());
    setSessionError('');
    navigate('/');
  }

  async function signOut() {
    try { await logout(); } finally {
      setMe(null);
      navigate('/login');
    }
  }

  if (loading) return <div className="center-panel" role="status"><span className="spinner" />Loading OpsDesk…</div>;
  if (!me) return <><Login onLogin={signIn} />{sessionError && <p className="session-error" role="alert">{sessionError}</p>}</>;

  const pathname = route.split('?')[0] ?? '/';
  const match = pathname.match(/^\/work-items\/([^/]+)$/);
  if (match) return <WorkItemDetail key={match[1]} id={decodeURIComponent(match[1]!)} me={me} onBack={() => navigate('/')} onLogout={signOut} />;
  return <Dashboard me={me} onOpenItem={(id) => navigate(`/work-items/${encodeURIComponent(id)}`)} onLogout={signOut} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
