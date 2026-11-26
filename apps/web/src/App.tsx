import { useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { startReviewSync } from './offline/reviews';
import { InstallPrompt } from './components/InstallPrompt';
import { useTrainingSummary } from './useTrainingSummary';
import { streakOf, useAnswers } from './activity';
import type { Me } from './api';
import { Explorer } from './pages/Explorer';
import { Home } from './pages/Home';
import { Games, useGamesReport } from './pages/Games';
import { LichessCallback } from './pages/LichessCallback';
import { RepertoireEditor } from './pages/RepertoireEditor';
import { Repertoires } from './pages/Repertoires';
import { NewRepertoire } from './pages/NewRepertoire';
import { Account } from './pages/Account';
import { Settings } from './pages/Settings';
import { Training } from './pages/Training';
import { t } from './i18n';
import { AppbarSlot, Button, Icon, Menu, plural, type IconName } from './ui';

/** The five sections: home, build, learn, explore, and what the games show. */
const SECTIONS: { to: string; label: string; icon: IconName; active: (path: string) => boolean }[] = [
  { to: '/', label: t('Accueil', 'Home'), icon: 'home', active: (p) => p === '/' },
  { to: '/repertoires', label: t('Répertoires', 'Repertoires'), icon: 'book', active: (p) => p.startsWith('/repertoires') || (p.startsWith('/r/') && !p.endsWith('/train')) },
  { to: '/train', label: t('Entraîner', 'Train'), icon: 'target', active: (p) => p.endsWith('/train') },
  { to: '/explorer', label: t('Explorer', 'Explore'), icon: 'compass', active: (p) => p.startsWith('/explorer') },
  { to: '/games', label: t('Mes parties', 'My games'), icon: 'games', active: (p) => p.startsWith('/games') },
];

/** Old addresses, kept working. */
function Redirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={to + search} replace />;
}

/** The database of this device could not be opened; the app asks again every 30 s. */
function Unreachable({ retry, retrying, error }: { retry: () => void; retrying: boolean; error: unknown }) {
  return (
    <div className="page narrow stack">
      <p className="notice error">{localProblem(error)}</p>
      <div>
        <Button onClick={retry} disabled={retrying}>
          {t('Réessayer', 'Try again')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The database of this device could not be opened: most often
 * e4e5 is open in another tab (the browser lets one tab at a time hold it). The app asks again
 * every 30 s, so closing the other tab is enough.
 */
function localProblem(error: unknown): string {
  const why = error instanceof Error ? error.message : String(error);
  // The worker's message (local/sqlite.worker.ts) is always in French.
  return why.includes('autre onglet')
    ? t('e4e5 est déjà ouvert dans un autre onglet : fermez-le, cette page reprend d’elle-même (ou rechargez-la).', 'e4e5 is already open in another tab: close it, this page resumes by itself (or reload it).')
    : t(`Les données de cet appareil n’ont pas pu être ouvertes (${why}). Rechargez la page.`, `The data of this device could not be opened (${why}). Reload the page.`);
}

/**
 * Everything is on the device: only its database failing to open is said. Being offline is not
 * (it matters only for Lichess and Chess.com, whose screens say when they cannot be reached).
 */
function DatabaseBanner({ error }: { error: unknown }) {
  return error ? <p className="notice error offline-banner" role="status">{localProblem(error)}</p> : null;
}

function Badge({ n, label }: { n: number; label: string }) {
  if (n <= 0) return null;
  return (
    <span className="tab-badge" aria-label={label} title={label}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

/** Mes parties: the errors of my games (moves played instead of the prepared ones), not ignored. */
function GamesBadge() {
  const n = useGamesReport().data?.inbox.errorCount ?? 0;
  return <Badge n={n} label={t(`${plural(n, 'erreur', 'erreurs')} dans vos parties`, `${plural(n, 'error', 'errors')} in your games`)} />;
}

export function App() {
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const restoring = useIsRestoring();
  // Asked again every 30 s while the database cannot be opened (e4e5 open in another tab).
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, refetchInterval: (q) => (q.state.error ? 30_000 : false) });
  const userId = me.data?.id;
  // Training answers waiting in the queue are recorded from here.
  useEffect(() => (userId ? startReviewSync(qc, userId) : undefined), [qc, userId]);
  // Badge of the Entraîner tab: lines to review today, plus the new lines still allowed today
  // (one daily limit for all repertoires).
  const summary = useTrainingSummary(me.data);
  // Home page: my series of days in a row, in the app bar.
  const onHome = pathname === '/';
  const streak = streakOf(useAnswers(onHome && !!me.data).answers.data);
  // Where the page header goes on a phone (ui.tsx PageHeader).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const active = (summary.data ?? []).filter((s) => s.active);
  const toTrain =
    active.reduce((n, s) => n + s.dueLines, 0) +
    Math.min(summary.data?.[0]?.remainingNewLines ?? 0, active.reduce((n, s) => n + s.availableLines, 0));
  const badge = (to: string) =>
    to === '/train' ? (
      <Badge n={toTrain} label={t(`${toTrain} lignes à revoir aujourd’hui`, `${toTrain} lines to review today`)} />
    ) : to === '/games' ? (
      <GamesBadge />
    ) : null;

  if (restoring || me.isLoading) return null;
  if (!me.data) return <Unreachable retry={() => void me.refetch()} retrying={me.isFetching} error={me.error} />;

  return (
    <div className="shell">
      <header className="appbar">
        <Link to="/" className="brand" title="e4e5">
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="e4e5" />
        </Link>
        {/* Phone: the page's header (back, title, actions), instead of the app's name. */}
        <div className="appbar-slot" ref={setSlot} />
        <nav className="appnav">
          {SECTIONS.map((s) => (
            <Link key={s.to} to={s.to} className={s.active(pathname) ? 'active' : ''}>
              {s.label}
              {badge(s.to)}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        {onHome && streak > 0 && (
          <span className="appbar-streak" title={t(plural(streak, 'jour d’affilée d’entraînement', 'jours d’affilée d’entraînement'), `${plural(streak, 'day', 'days')} of training in a row`)}>
            🔥 {streak}
          </span>
        )}
        <Menu
          trigger={me.data.username.slice(0, 1).toUpperCase()}
          title={t('Compte', 'Account')}
          label={me.data.username}
          items={[
            { label: t('Mon compte', 'My account'), to: '/account' },
            { label: t('Paramètres', 'Settings'), to: '/settings' },
          ]}
        />
      </header>

      <DatabaseBanner error={me.error} />

      <AppbarSlot.Provider value={slot}>
      <main className="page">
        <Routes>
          <Route path="/" element={<Home me={me.data} />} />
          <Route path="/games" element={<Games />} />
          <Route path="/repertoires" element={<Repertoires me={me.data} />} />
          <Route path="/repertoires/new" element={<NewRepertoire me={me.data} />} />
          <Route path="/r/:id" element={<RepertoireEditor me={me.data} />} />
          <Route path="/r/:id/train" element={<Training me={me.data} />} />
          <Route path="/train" element={<Training me={me.data} />} />
          <Route path="/explorer" element={<Explorer me={me.data} />} />
          <Route path="/gaps" element={<Redirect to="/games" />} />
          <Route path="/settings" element={<Settings me={me.data} />} />
          <Route path="/account" element={<Account me={me.data} />} />
          <Route path="/lichess-callback" element={<LichessCallback />} />
          {/* Former French addresses. */}
          <Route path="/parties" element={<Redirect to="/games" />} />
          <Route path="/lacunes" element={<Redirect to="/games" />} />
          <Route path="/compte" element={<Redirect to="/account" />} />
          <Route path="/repertoires/nouveau" element={<Redirect to="/repertoires/new" />} />
          <Route path="/bilan/*" element={<Redirect to="/games" />} />
          <Route path="/stats" element={<Redirect to="/games" />} />
          <Route path="*" element={<Redirect to="/" />} />
        </Routes>
      </main>
      </AppbarSlot.Provider>

      <InstallPrompt />

      <nav className="tabbar">
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to} className={s.active(pathname) ? 'active' : ''}>
            <Icon name={s.icon} size={22} />
            {s.label}
            {badge(s.to)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
