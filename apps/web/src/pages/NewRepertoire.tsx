import { lichessStudyRef, pgnToMoves, trunkOf, type ChapterKind, type Color, type Thumbnail } from '@e4e5/core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type LichessStudy, type Me } from '../api';
import { lineText } from '../chessText';
import { MiniBoard } from '../components/MiniBoard';
import { locale, t } from '../i18n';
import { canSearchLichess, searchLichessStudies, studyHint } from '../lichessSearch';
import { Button, Icon, PageHeader, Tabs, plural } from '../ui';

/** The value after `ms` without change (the search waits for the typing to stop). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const arrowsOf = (t: Thumbnail) => t.branches.map((uci) => ({ uci, kind: 'repertoire' as const }));
const COLOR_TABS = [
  { id: 'white' as const, label: <><span className="dot white" /> {t('Blancs', 'White')}</> },
  { id: 'black' as const, label: <><span className="dot black" /> {t('Noirs', 'Black')}</> },
];

/**
 * New repertoire, from one search field: what is typed is the name of an empty repertoire to
 * create (Entrée, or the "Créer" row) and searches the Lichess studies (all of them in the native
 * app, my own ones everywhere); a pasted study link opens it. A study opens its chapters to choose from (?study=, ?chapter= for a
 * chapter link).
 */
export function NewRepertoire({ me }: { me: Me }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const studyId = params.get('study');
  const chapterId = params.get('chapter') ?? undefined;

  const created = async (rep: { id: string }) => {
    // A new repertoire changes the missing moves and the lines to train too.
    for (const key of ['gaps', 'training-summary']) void qc.invalidateQueries({ queryKey: [key] });
    await qc.invalidateQueries({ queryKey: ['repertoires'] });
    navigate(`/r/${rep.id}`);
  };
  const openStudy = (ref: { studyId: string; chapterId?: string }) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('study', ref.studyId);
      if (ref.chapterId) next.set('chapter', ref.chapterId);
      else next.delete('chapter');
      // A pasted link is not a search to come back to.
      if (lichessStudyRef(next.get('q') ?? '')) next.delete('q');
      return next;
    });
  const closeStudy = () =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('study');
      next.delete('chapter');
      return next;
    });

  return (
    <div className="new-rep-page">
      <PageHeader title={t('Nouveau répertoire', 'New repertoire')} back={studyId ? undefined : '/repertoires'} />
      {studyId ? (
        <StudyImport key={studyId} studyId={studyId} chapterId={chapterId} onBack={closeStudy} onCreated={created} />
      ) : (
        <Catalogue me={me} onOpen={openStudy} onCreated={created} />
      )}
    </div>
  );
}

/** Lower case without accents, for the search. */
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const monthYear = (ms: number) => new Date(ms).toLocaleDateString(locale, { month: 'short', year: 'numeric' });
const likes = (n: number) => (n >= 1000 ? t(`${(n / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} k`, `${(n / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })}k`) : String(n));
/** Rows shown before "Afficher plus" (my studies). */
const SHOWN = 40;

type Source = 'lichess' | 'mine';

/**
 * The search field with the side (the empty repertoire's), the empty repertoire named after
 * what is typed ("Créer « … »", once typing), and the Lichess studies to start from: all authors,
 * most liked first, searched from the device (native app only, see lichessSearch.ts), and my own
 * studies (official API, filtered by what is typed). A pasted study link opens it.
 */
function Catalogue({ me, onOpen, onCreated }: { me: Me; onOpen: (ref: { studyId: string; chapterId?: string }) => void; onCreated: (rep: { id: string }) => void }) {
  const [params, setParams] = useSearchParams();
  // Typed into local state (the URL lags behind fast typing), copied to the URL (?q=) to come back to.
  const [input, setInput] = useState(() => params.get('q') ?? '');
  const color: Color = params.get('color') === 'black' ? 'black' : 'white';
  const mine = me.lichess?.username;
  const native = canSearchLichess();
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const ref = lichessStudyRef(input);
  const name = ref ? '' : input.trim().slice(0, 100);
  const q = useDebounced(name, 400);
  useEffect(() => {
    if (ref) onOpen(ref);
  }, [ref?.studyId, ref?.chapterId]);
  useEffect(() => {
    if (!ref) set('q', q);
  }, [q]);

  // All of Lichess when it can be searched (native app), else my studies.
  const sources: Source[] = [...(native ? (['lichess'] as const) : []), ...(mine ? (['mine'] as const) : [])];
  const source: Source | undefined = sources.find((x) => x === params.get('source')) ?? sources[0];
  // One chapter to start with, of the same name.
  const create = useMutation({ mutationFn: () => api.createRepertoire(name, color, { chapters: [{ name: name.trim() }] }), onSuccess: onCreated });
  const side = color === 'white' ? t('Blancs', 'White') : t('Noirs', 'Black');

  return (
    <section className="catalogue">
      {/* Enter creates the empty repertoire named after what is typed. */}
      <form
        className="new-rep-bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (name && !create.isPending) create.mutate();
        }}
      >
        <label className="rep-search new-rep-search">
          <Icon name="search" size={20} />
          <input
            autoFocus
            type="search"
            placeholder={native ? t('Nom du répertoire ou ouverture à chercher (Caro-Kann…)', 'Repertoire name, or opening to search (Caro-Kann…)') : t('Nom du répertoire, ou lien d’une étude Lichess', 'Repertoire name, or link to a Lichess study')}
            aria-label={t('Nom du répertoire, ou étude Lichess à chercher', 'Repertoire name, or Lichess study to search')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <Tabs value={color} onChange={(c) => set('color', c === 'white' ? '' : c)} tabs={COLOR_TABS} />
      </form>

      {/* Once typing, what is typed is also the name of an empty repertoire of the side chosen. */}
      {name && (
        <button type="button" className="create-row" onClick={() => create.mutate()} disabled={create.isPending}>
          <span className="create-icon" aria-hidden="true"><Icon name="plus" size={18} /></span>
          <span className="create-text">
            <strong>{t(`Créer « ${name} » avec les ${side}`, `Create “${name}” with ${side}`)}</strong>
            <span className="muted small-text">{t('Répertoire vide : vous ajoutez vos coups dans l’éditeur. Entrée pour créer.', 'Empty repertoire: you add your moves in the editor. Enter to create.')}</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      {create.error && <p className="error">{create.error.message}</p>}

      <div className="catalogue-head">
        <h3>{name ? t('Ou partir d’une étude Lichess', 'Or start from a Lichess study') : t('Partir d’une étude Lichess', 'Start from a Lichess study')}</h3>
        {sources.length > 1 && (
          <div className="author-chips" role="tablist" aria-label={t('Études', 'Studies')}>
            {sources.map((x) => (
              <button key={x} type="button" role="tab" aria-selected={x === source} className={`chip ${x === source ? 'on' : ''}`} onClick={() => set('source', x === sources[0] ? '' : x)}>
                {x === 'lichess' ? t('Toutes les études', 'All studies') : t('Mes études', 'My studies')}
              </button>
            ))}
          </div>
        )}
      </div>
      {source === 'lichess' && <LichessResults q={q} onOpen={onOpen} />}
      {source === 'mine' && <MyStudies username={mine!} name={name} onOpen={onOpen} />}
      {!source && (
        <p className="muted catalogue-empty">
          {t('Collez le lien d’une étude Lichess (lichess.org/study/…) pour l’importer', 'Paste the link to a Lichess study (lichess.org/study/…) to import it')}
          {me.lichess ? '.' : t(', ou liez votre compte Lichess (Compte) pour retrouver vos études ici.', ', or link your Lichess account (Account) to find your studies here.')}
        </p>
      )}
    </section>
  );
}

/** Lichess's own search, from the device: all authors, most liked first, page by page. */
function LichessResults({ q, onOpen }: { q: string; onOpen: (ref: { studyId: string }) => void }) {
  const list = useInfiniteQuery({
    queryKey: ['lichess-search', q],
    queryFn: ({ pageParam }) => searchLichessStudies(q, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.nbPages ? last.page + 1 : undefined),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const studies = list.data?.pages.flatMap((p) => p.studies) ?? [];
  const total = list.data?.pages[0]?.nbResults ?? 0;
  return (
    <>
      <p className="muted small-text catalogue-note">
        {list.isLoading
          ? q ? t(`Recherche de « ${q} »…`, `Searching “${q}”…`) : t('Chargement…', 'Loading…')
          : q
            ? t(`${plural(total, 'étude', 'études')} pour « ${q} », les plus aimées d’abord.`, `${plural(total, 'study', 'studies')} for “${q}”, most liked first.`)
            : t('Les plus aimées de Lichess.', 'The most liked on Lichess.')}
      </p>
      {list.error && <p className="error">{list.error.message}</p>}
      {list.data && studies.length === 0 && <p className="muted catalogue-empty">{t('Aucune étude trouvée.', 'No study found.')}</p>}
      {studies.length > 0 && (
        <ul className="study-rows">
          {studies.map((s) => {
            const hint = studyHint(s.topics);
            return (
              <li key={s.id}>
                <button type="button" className={`study-row ${hint ? 'other' : ''}`} onClick={() => onOpen({ studyId: s.id })}>
                  <span className="study-text">
                    <span className="study-name">
                      {s.name}
                      {hint && <span className="study-hint" title={t('D’après ses thèmes, pas une étude d’ouverture', 'From its topics, not an opening study')}>{hint}</span>}
                    </span>
                    <span className="study-meta">♥ {likes(s.likes)} · {s.owner}{s.topics.length > 0 && ` · ${s.topics.slice(0, 2).join(', ')}`}</span>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="catalogue-more">
          <Button onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? t('Chargement…', 'Loading…') : t('Plus d’études', 'More studies')}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Authorises Lichess again, now with the scope study:read: accounts linked before it was asked
 * only see their public studies.
 */
function relinkLichess() {
  void import('../local/lichessLogin').then((m) => m.startLichessLogin());
}

/**
 * My Lichess studies (official API, with my token: the private ones too), most recent first,
 * filtered by what is typed.
 */
function MyStudies({ username, name, onOpen }: { username: string; name: string; onOpen: (ref: { studyId: string }) => void }) {
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [name]);
  const list = useQuery({
    queryKey: ['lichess-studies-by', username.toLowerCase()],
    queryFn: () => api.lichessStudiesBy(username),
    staleTime: 30 * 60_000,
    retry: false,
  });
  const words = norm(name).split(/\s+/).filter(Boolean);
  const matching = (list.data ?? []).filter((s) => words.every((w) => norm(s.name).includes(w)));
  const shown = all ? matching : matching.slice(0, SHOWN);
  return (
    <>
      <p className="muted small-text catalogue-note">
        {list.isLoading
          ? t('Chargement de vos études…', 'Loading your studies…')
          : list.data && list.data.length > 0
            ? name
              ? matching.length
                ? t(`${plural(matching.length, 'de vos études contient', 'de vos études contiennent')} « ${name} ».`, `${plural(matching.length, 'of your studies contains', 'of your studies contain')} “${name}”.`)
                : ''
              : t(`Vos ${plural(list.data.length, 'étude', 'études')} sur Lichess, les plus récentes d’abord.`, `Your ${plural(list.data.length, 'study', 'studies')} on Lichess, most recent first.`)
            : ''}
      </p>
      {list.error && <p className="error">{list.error.message}</p>}
      {list.data && matching.length === 0 && (
        <p className="muted catalogue-empty">{name && list.data.length ? t(`Aucune de vos études ne contient « ${name} ».`, `None of your studies contains “${name}”.`) : t('Vous n’avez pas d’étude sur Lichess.', 'You have no study on Lichess.')}</p>
      )}
      {shown.length > 0 && (
        <ul className="study-rows">
          {shown.map((s) => (
            <li key={s.id}>
              <button type="button" className="study-row" onClick={() => onOpen({ studyId: s.id })}>
                <span className="study-text">
                  <span className="study-name">{s.name}</span>
                  <span className="study-meta">{monthYear(s.updatedAt)}</span>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!all && matching.length > SHOWN && (
        <div className="catalogue-more">
          <Button onClick={() => setAll(true)}>{t(plural(matching.length - SHOWN, 'autre étude', 'autres études'), plural(matching.length - SHOWN, 'more study', 'more studies'))}</Button>
        </div>
      )}
      {list.data && (
        <p className="muted small-text catalogue-note">
          {t('Vos études privées n’apparaissent pas ?', 'Your private studies are missing?')}{' '}
          <button type="button" className="link" onClick={relinkLichess}>
            {t('Autoriser e4e5 à les lire sur Lichess', 'Let e4e5 read them on Lichess')}
          </button>
        </p>
      )}
    </>
  );
}

/**
 * A study opened: its chapters to choose from (those of the side chosen, joined to the others),
 * the board showing where they lead (the chapter under the pointer, else the selection), and
 * what will be imported.
 */
/** The groups of chapters, in this order, and why a kind cannot join a repertoire. */
const KINDS: { kind: ChapterKind; label: string; why?: string }[] = [
  { kind: 'opening', label: t('Ouvertures', 'Openings') },
  { kind: 'game', label: t('Parties commentées', 'Annotated games') },
  { kind: 'endgame', label: t('Finales', 'Endgames'), why: t('Finale : commence à sa propre position, ses coups ne peuvent pas rejoindre un répertoire d’ouverture.', 'Endgame: starts from its own position, its moves cannot join an opening repertoire.') },
  { kind: 'position', label: t('Positions (milieu de jeu, tactique…)', 'Positions (middlegame, tactics…)'), why: t('Commence à une position qu’aucun autre chapitre n’atteint : ses coups ne peuvent pas rejoindre le répertoire.', 'Starts from a position no other chapter reaches: its moves cannot join the repertoire.') },
];

function StudyImport({
  studyId,
  chapterId,
  onBack,
  onCreated,
}: {
  studyId: string;
  chapterId?: string;
  onBack: () => void;
  onCreated: (rep: { id: string }) => void;
}) {
  const study = useQuery({ queryKey: ['lichess-study', studyId], queryFn: () => api.lichessStudy(studyId), retry: false, staleTime: 10 * 60_000 });
  const [name, setName] = useState('');
  const [color, setColor] = useState<Color>('white');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  /** The side a chapter is studied from (its orientation, else the study's). */
  const sideOf = (s: LichessStudy, ch: LichessStudy['chapters'][number]) => ch.orientation ?? s.color;
  /**
   * Checked by default: the chapter of the link, else the opening chapters of both sides (the
   * commented games can join too, but are checked by hand: one long line is not a repertoire).
   * The side chosen only filters them.
   */
  const defaults = (s: LichessStudy) => {
    const only = chapterId ? s.chapters.findIndex((ch) => ch.id === chapterId) : -1;
    if (only >= 0 && s.chapters[only]!.joins) return new Set([only]);
    return new Set(s.chapters.flatMap((ch, i) => (ch.joins && ch.kind === 'opening' && ch.moves > 0 ? [i] : [])));
  };
  useEffect(() => {
    const s = study.data;
    if (!s) return;
    setName(s.name.slice(0, 100));
    const linked = chapterId ? s.chapters.find((ch) => ch.id === chapterId) : undefined;
    setColor(linked ? sideOf(s, linked) : s.color);
    setChosen(defaults(s));
  }, [study.data]);

  const s = study.data;
  /** The chapters of the side chosen (the others are hidden, and not imported). */
  const visible = (i: number) => !!s && sideOf(s, s.chapters[i]!) === color;
  const picked = useMemo(() => new Set([...chosen].filter(visible)), [chosen, s, color]);
  // What will be imported: distinct moves, how deep, and where the lines split.
  const selection = useMemo(() => {
    const picked = s ? s.chapters.filter((_, i) => chosen.has(i) && visible(i)) : [];
    const moves = picked.flatMap((c) => pgnToMoves(c.pgn).moves);
    return {
      moves: new Set(moves.map((m) => `${m.fromFen} ${m.uci}`)).size,
      maxPly: Math.max(0, ...picked.map((c) => c.maxPly)),
      trunk: trunkOf(moves),
    };
  }, [s, chosen, color]);

  // One chapter per chapter of the study, keeping its Lichess id (to sync it later).
  const create = useMutation({
    mutationFn: () =>
      api.createRepertoire(name.trim(), color, {
        lichessStudyId: s!.id,
        chapters: s!.chapters.filter((_, i) => picked.has(i)).map((c) => ({ name: c.name, pgn: c.pgn, lichessChapterId: c.id ?? null })),
      }),
    onSuccess: onCreated,
  });

  const toggle = (i: number) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const shown = hover !== null && s ? s.chapters[hover]!.trunk : selection.trunk;
  const caption =
    hover !== null && s ? s.chapters[hover]!.name : selection.trunk.sans.length ? lineText(selection.trunk.sans) : t('Position initiale', 'Starting position');

  return (
    <div className="study-import">
      <div className="study-import-nav">
        <button type="button" className="link" onClick={onBack}>
          <Icon name="back" size={16} /> {t('Toutes les études', 'All studies')}
        </button>
        <a className="small-text" href={`https://lichess.org/study/${studyId}`} target="_blank" rel="noreferrer">{t('Voir sur Lichess ↗', 'View on Lichess ↗')}</a>
      </div>
      {study.isLoading && <p className="muted">{t('Chargement de l’étude…', 'Loading the study…')}</p>}
      {study.error && <p className="error">{study.error.message}</p>}
      {s && (
        <div className="study-import-body">
          <figure className="study-board">
            <MiniBoard className="mini-board-large" fen={shown.fen} orientation={color} arrows={arrowsOf(shown)} />
            <figcaption className="muted small-text">{caption}</figcaption>
          </figure>
          <form
            className="study-form stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && picked.size) create.mutate();
            }}
          >
            <label className="field">
              <span className="field-label">{t('Nom du répertoire', 'Repertoire name')}</span>
              <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="field">
              <span className="field-label">{t('Je joue', 'I play')}</span>
              <Tabs
                block
                value={color}
                onChange={setColor}
                tabs={COLOR_TABS}
              />
            </div>
            <div className="field">
              <span className="field-label">{t('Chapitres', 'Chapters')}</span>
              <div className="chapter-groups" onMouseLeave={() => setHover(null)}>
                {!s.chapters.some((_, i) => visible(i)) && (
                  <p className="muted small-text">
                    {color === 'white'
                      ? t('Aucun chapitre de cette étude n’est étudié avec les Blancs.', 'No chapter of this study is studied with White.')
                      : t('Aucun chapitre de cette étude n’est étudié avec les Noirs.', 'No chapter of this study is studied with Black.')}
                  </p>
                )}
                {KINDS.map(({ kind, label, why }) => {
                  const group = s.chapters.flatMap((c, i) => (c.kind === kind && visible(i) ? [{ c, i }] : []));
                  if (!group.length) return null;
                  // Headings only when the chapters shown mix kinds (a pure opening study stays a plain list).
                  const mixed = s.chapters.some((c, i) => visible(i) && c.kind !== 'opening');
                  return (
                    <section key={kind} className="chapter-group">
                      {mixed && (
                        <h4 className="chapter-group-title">
                          {label} <span className="muted">· {group.length}</span>
                        </h4>
                      )}
                      <ul className="chapter-list">
                        {group.map(({ c, i }) => {
                          const usable = c.joins && c.moves > 0;
                          return (
                            <li key={i} onMouseEnter={() => setHover(i)}>
                              <label
                                className={`chapter ${chosen.has(i) ? 'on' : ''} ${usable ? '' : 'disabled'}`}
                                title={
                                  !c.joins
                                    ? why ?? KINDS.at(-1)!.why
                                    : c.moves === 0
                                      ? t('Chapitre sans coups', 'Chapter without moves')
                                      : kind === 'game'
                                        ? t('Partie : une longue ligne, pas cochée par défaut', 'Game: one long line, not checked by default')
                                        : undefined
                                }
                              >
                                <input type="checkbox" checked={chosen.has(i)} disabled={!usable} onChange={() => toggle(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
                                <span className="chapter-name">{c.name}</span>
                                <span className="chapter-moves">{c.moves ? t(plural(c.moves, 'coup', 'coups'), plural(c.moves, 'move', 'moves')) : t('sans coups', 'no moves')}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </div>
            <div className="import-summary">
              {picked.size ? (
                <>
                  <strong>{t(plural(picked.size, 'chapitre', 'chapitres'), plural(picked.size, 'chapter', 'chapters'))}</strong> · {t(plural(selection.moves, 'coup', 'coups'), plural(selection.moves, 'move', 'moves'))}
                  {selection.maxPly > 0 && t(<> · lignes jusqu’au {Math.ceil(selection.maxPly / 2)}<sup>e</sup> coup</>, <> · lines up to move {Math.ceil(selection.maxPly / 2)}</>)}
                </>
              ) : (
                t('Choisissez au moins un chapitre.', 'Choose at least one chapter.')
              )}
            </div>
            <Button type="submit" variant="primary" block disabled={!name.trim() || picked.size === 0 || create.isPending}>
              {create.isPending ? t('Import…', 'Importing…') : t('Importer dans mes répertoires', 'Import into my repertoires')}
            </Button>
            {create.error && <p className="error">{create.error.message}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
