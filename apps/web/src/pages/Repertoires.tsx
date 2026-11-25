import { START_FEN, type Color } from '@e4e5/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Me, type RepertoireSummary, type TrainingSummary } from '../api';
import { locale, t } from '../i18n';
import { useTrainingSummary } from '../useTrainingSummary';
import { Button, EmptyState, Icon, PageHeader, Switch, Tabs, plural } from '../ui';
import { useGaps } from '../useGaps';
import { lineText } from '../chessText';
import { useLongPress } from '../components/useLongPress';
import { MiniBoard } from '../components/MiniBoard';

const COLORS: { color: Color; label: string }[] = [
  { color: 'white', label: t('Avec les Blancs', 'With White') },
  { color: 'black', label: t('Avec les Noirs', 'With Black') },
];

type ColorFilter = 'all' | Color;
type StatusFilter = 'all' | 'due' | 'new' | 'missing' | 'active' | 'paused';
type Sort = 'name' | 'due' | 'lines' | 'recent';

const STATUSES: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: t('Tous les états', 'All states') },
  { id: 'due', label: t('À revoir', 'Due') },
  { id: 'new', label: t('Nouvelles lignes', 'New lines') },
  { id: 'missing', label: t('Coups manquants', 'Missing moves') },
  { id: 'active', label: t('En entraînement', 'In training') },
  { id: 'paused', label: t('En pause', 'Paused') },
];
const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: t('Plus récents', 'Most recent') },
  { id: 'name', label: t('Nom', 'Name') },
  { id: 'due', label: t('À revoir', 'Due') },
  { id: 'lines', label: t('Nombre de lignes', 'Number of lines') },
];

/** Lower case without accents, for the search. */
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const oneOf = <T extends string>(v: string | null, ids: readonly T[], def: T): T => (ids.includes(v as T) ? (v as T) : def);

export function Repertoires({ me }: { me: Me }) {
  const reps = useQuery({ queryKey: ['repertoires'], queryFn: api.repertoires });
  const summary = useTrainingSummary(me);
  const counts = new Map((summary.data ?? []).map((s) => [s.repertoireId, s]));
  const gaps = useGaps(me, (reps.data?.length ?? 0) > 0);
  // Missing moves of each repertoire: frequent opponent moves it does not answer (gap finder).
  // The gaps come most frequent first: the first one of a repertoire is the one its badge opens.
  const missing = new Map<string, number>();
  const firstGap = new Map<string, string[]>();
  for (const g of [...(gaps.data?.white?.gaps ?? []), ...(gaps.data?.black?.gaps ?? [])]) {
    if (!g.repertoireId) continue;
    missing.set(g.repertoireId, (missing.get(g.repertoireId) ?? 0) + 1);
    if (!firstGap.has(g.repertoireId)) firstGap.set(g.repertoireId, g.move ? [...g.ucis, g.move.uci] : g.ucis);
  }

  // Filters live in the URL: they survive opening a repertoire and coming back.
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const colorFilter = oneOf<ColorFilter>(params.get('color'), ['all', 'white', 'black'], 'all');
  const status = oneOf<StatusFilter>(params.get('status'), STATUSES.map((s) => s.id), 'all');
  const sort = oneOf<Sort>(params.get('sort'), SORTS.map((s) => s.id), 'recent');
  const setParam = (key: string, value: string, def: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value === def) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const list = reps.data ?? [];
  const byColor = (c: Color) => list.filter((r) => r.color === c).length;
  const q = norm(query.trim());
  const matches = (r: RepertoireSummary) => {
    if (q && !norm(r.name).includes(q) && !r.chapters?.some((c) => norm(c.name).includes(q))) return false;
    if (colorFilter !== 'all' && r.color !== colorFilter) return false;
    const c = counts.get(r.id);
    switch (status) {
      case 'due': return r.active && !!c && c.dueLines > 0;
      case 'new': return r.active && !!c && c.newLines > 0;
      case 'missing': return (missing.get(r.id) ?? 0) > 0;
      case 'active': return r.active;
      case 'paused': return !r.active;
      default: return true;
    }
  };
  const byName = (a: RepertoireSummary, b: RepertoireSummary) => a.name.localeCompare(b.name, locale, { sensitivity: 'base', numeric: true });
  const compare = (a: RepertoireSummary, b: RepertoireSummary) => {
    const ca = counts.get(a.id);
    const cb = counts.get(b.id);
    switch (sort) {
      case 'due': {
        const due = (r: RepertoireSummary, c?: TrainingSummary) => (r.active && c ? c.dueLines : -1);
        return due(b, cb) - due(a, ca) || byName(a, b);
      }
      case 'lines': return (cb?.totalLines ?? -1) - (ca?.totalLines ?? -1) || byName(a, b);
      case 'recent': return b.createdAt.localeCompare(a.createdAt) || byName(a, b);
      default: return byName(a, b);
    }
  };
  const shown = list.filter(matches).sort(compare);
  const filtered = q !== '' || colorFilter !== 'all' || status !== 'all';
  const statusOptions = STATUSES.filter((s) => s.id !== 'missing' || gaps.data);

  return (
    <div className="narrow-page">
      <PageHeader
        title={t('Répertoires', 'Repertoires')}
        subtitle={list.length ? t(plural(list.length, 'répertoire', 'répertoires'), plural(list.length, 'repertoire', 'repertoires')) : undefined}
        actions={list.length > 0 && <Button variant="primary" icon="plus" to="/repertoires/new">{t('Nouveau', 'New')}</Button>}
      />

      {reps.isLoading && <p className="muted">{t('Chargement…', 'Loading…')}</p>}
      {!reps.isLoading && list.length === 0 && (
        <EmptyState
          title={t('Aucun répertoire', 'No repertoire')}
          action={<Button variant="primary" icon="plus" to="/repertoires/new">{t('Créer un répertoire', 'Create a repertoire')}</Button>}
        >
          {t(
            'Un répertoire regroupe vos coups pour une couleur (par exemple « 1.e4 avec les Blancs »). Partez de zéro, ou d’une étude Lichess populaire.',
            'A repertoire groups your moves for one colour (for example “1.e4 with White”). Start from scratch, or from a popular Lichess study.',
          )}
        </EmptyState>
      )}

      {list.length > 0 && (
        <div className="rep-toolbar">
          <label className="rep-search">
            <Icon name="search" size={18} />
            <input
              type="search"
              placeholder={t('Rechercher un répertoire', 'Search repertoires')}
              aria-label={t('Rechercher un répertoire', 'Search repertoires')}
              value={query}
              onChange={(e) => setParam('q', e.target.value, '')}
            />
          </label>
          <Tabs
            value={colorFilter}
            onChange={(v) => setParam('color', v, 'all')}
            tabs={[
              { id: 'all', label: <>{t('Tous', 'All')} <span className="count">{list.length}</span></> },
              { id: 'white', label: <><span className="dot white" /> {t('Blancs', 'White')} <span className="count">{byColor('white')}</span></> },
              { id: 'black', label: <><span className="dot black" /> {t('Noirs', 'Black')} <span className="count">{byColor('black')}</span></> },
            ]}
          />
          <div className="rep-selects">
            <select aria-label={t('Filtrer par état', 'Filter by state')} value={status} onChange={(e) => setParam('status', e.target.value, 'all')}>
              {statusOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select aria-label={t('Trier', 'Sort')} value={sort} onChange={(e) => setParam('sort', e.target.value, 'recent')}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{t('Tri : ', 'Sort: ')}{s.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {list.length > 0 && filtered && (
        <div className="rep-results muted">
          {shown.length ? t(`${shown.length} sur ${list.length}`, `${shown.length} of ${list.length}`) : t('Aucun répertoire ne correspond', 'No repertoire matches')}
          <button type="button" className="link" onClick={() => setParams({}, { replace: true })}>{t('Effacer les filtres', 'Clear filters')}</button>
        </div>
      )}

      {/* Grouped by colour when both are shown, a single list otherwise. */}
      {(colorFilter === 'all' ? COLORS : COLORS.filter((c) => c.color === colorFilter)).map(({ color: c, label }) => {
        const own = shown.filter((r) => r.color === c);
        if (!own.length) return null;
        return (
          <section key={c}>
            {colorFilter === 'all' && <h4 className="section-title">{label} <span className="count">{own.length}</span></h4>}
            <div className="rep-list">
              {own.map((r) => (
                <RepertoireRow
                  key={r.id}
                  rep={r}
                  counts={counts.get(r.id)}
                  missing={gaps.data ? missing.get(r.id) ?? 0 : undefined}
                  firstGap={firstGap.get(r.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RepertoireRow({ rep, counts, missing, firstGap }: {
  rep: RepertoireSummary;
  counts?: TrainingSummary;
  missing?: number;
  /** Line (UCI) of the most frequent missing move, the move included. */
  firstGap?: string[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api.setRepertoireActive(rep.id, !rep.active),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['repertoires'] }), qc.invalidateQueries({ queryKey: ['training-summary'] }), qc.invalidateQueries({ queryKey: ['games-report'] })]),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteRepertoire(rep.id),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['repertoires'] }), qc.invalidateQueries({ queryKey: ['training-summary'] }), qc.invalidateQueries({ queryKey: ['games-report'] })]),
  });
  const askDelete = () => {
    if (confirm(t(`Supprimer le répertoire « ${rep.name} », ses chapitres et tous leurs coups ?`, `Delete the repertoire “${rep.name}”, its chapters and all their moves?`))) remove.mutate();
  };
  // Long press (touch) or right click (mouse) offers to delete the repertoire.
  const longPress = useLongPress();
  const arrows = (rep.branches ?? []).map((uci) => ({ uci, kind: 'repertoire' as const }));
  // The whole row opens the repertoire; the switch stops the click.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const go = (to: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(to);
  };
  return (
    <div
      className={`rep-row ${rep.active ? '' : 'paused'}`}
      onClick={() => navigate(`/r/${rep.id}`)}
      {...longPress(askDelete)}
    >
      <div className="rep-thumb" title={rep.trunk?.length ? lineText(rep.trunk) : t('Position initiale', 'Starting position')}>
        <MiniBoard fen={rep.trunkFen ?? START_FEN} orientation={rep.color} arrows={arrows} />
      </div>
      <div className="info">
        <Link className="name" to={`/r/${rep.id}`} onClick={stop}>{rep.name}</Link>
        <div className="meta">
          {(rep.chapters?.length ?? 0) !== 1 && `${t(plural(rep.chapters?.length ?? 0, 'chapitre', 'chapitres'), plural(rep.chapters?.length ?? 0, 'chapter', 'chapters'))} · `}
          {counts ? t(plural(counts.totalLines, 'ligne', 'lignes'), plural(counts.totalLines, 'line', 'lines')) : '…'}
          {/* Share of the positions trained (at the depth of the lines, Paramètres) seen at least once. */}
          {counts && counts.total > 0 && (
            <span
              title={t(
                'Part des positions entraînées où vous avez déjà appris au moins un coup. Positions entraînées : selon la profondeur des lignes choisie dans les Paramètres.',
                'Share of the trained positions where you have already learnt at least one move. Trained positions: according to the depth of the lines chosen in the Settings.',
              )}
            >
              {' · '}
              {t(
                <>vu à <strong className="known">{Math.round(100 * counts.seen)} %</strong></>,
                <><strong className="known">{Math.round(100 * counts.seen)}%</strong> seen</>,
              )}
            </span>
          )}
        </div>
        {/* Clickable: review this repertoire, or open the editor on its most frequent missing move. */}
        <div className="badges">
          {rep.active && counts && counts.dueLines > 0 && (
            <button type="button" className="badge warn" title={t('Réviser les lignes à revoir aujourd’hui', 'Review the lines due today')} onClick={go(`/r/${rep.id}/train?mode=review`)}>
              {t(`${counts.dueLines} à revoir`, `${counts.dueLines} due`)}
            </button>
          )}
          {rep.active && counts && counts.newLines > 0 && (
            <button type="button" className="badge" title={t('Apprendre les lignes pas encore apprises', 'Learn the lines not learnt yet')} onClick={go(`/r/${rep.id}/train?mode=review`)}>
              {t(plural(counts.newLines, 'nouvelle', 'nouvelles'), `${counts.newLines} new`)}
            </button>
          )}
          {!!missing && (
            <button
              type="button"
              className="badge hole"
              title={t('Coups adverses fréquents que ce répertoire ne prévoit pas encore : ouvrir le plus fréquent', 'Frequent opponent moves this repertoire does not cover yet: open the most frequent')}
              onClick={go(firstGap ? `/r/${rep.id}?${new URLSearchParams({ line: firstGap.join(','), gap: '1' })}` : `/r/${rep.id}`)}
            >
              {t(plural(missing, 'coup manquant', 'coups manquants'), plural(missing, 'missing move', 'missing moves'))}
            </button>
          )}
        </div>
        <div className="toggle" onClick={stop}>
          <Switch
            on={rep.active}
            disabled={toggle.isPending}
            onChange={() => toggle.mutate()}
            label={rep.active ? t(`Mettre ${rep.name} en pause`, `Pause ${rep.name}`) : t(`Reprendre l’entraînement de ${rep.name}`, `Resume training ${rep.name}`)}
          />
          <span>{rep.active ? t('En entraînement', 'In training') : t('En pause', 'Paused')}</span>
        </div>
      </div>
    </div>
  );
}
