import { pathTo, playUci, Repertoire, START_FEN, totalGames, turnOf, type PlayedMove } from '@e4e5/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Gap, type Me, type RepertoireDetail, type StoredMove } from '../api';
import { chapterForLine, chapterForPosition, chapterRoot, playLine } from '../chapters';
import { ChapterBar } from '../components/ChapterBar';
import { StudySyncDialog } from '../components/StudySyncDialog';
import { PushDialog } from '../components/PushDialog';
import type { DropTarget } from '../components/useMoveDrag';
import { MoveChips } from '../components/MoveChips';
import { MoveActionsDialog } from '../components/MoveActionsDialog';
import { OUTLINE_EXTRA, type ArrowKind } from '../components/arrows';
import { EvalBar } from '../components/EnginePanel';
import { useTableEngine } from '../engine/useEngine';
import { Board } from '../components/Board';
import { MOVE_NAGS, moveNag, San } from '../components/Nag';
import { ExplorerPanel } from '../components/ExplorerPanel';
import { AnalysisToggle, useAnalysisToggle } from '../components/ToolCards';
import { explorerParams, rangeLabel, useSettings } from '../settings';
import { LEVEL_STEPS, topLevelMove, useBestMoves, useLevelDepth } from '../components/BestMoves';
import { Suggestions } from '../components/Suggestions';
import { t } from '../i18n';
import { Button, Icon, PageHeader, plural } from '../ui';
import { useGaps } from '../useGaps';


/** A move of the line on the board; saved or not is derived from the repertoire. */
type LineMove = PlayedMove;

export function RepertoireEditor({ me }: { me: Me }) {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { speed, range } = useSettings();
  const gapReport = useGaps(me);
  const { data, isLoading, error } = useQuery({ queryKey: ['repertoire', id], queryFn: () => api.repertoire(id) });
  /**
   * The line on the board and the cursor in it. Moves played on the board are a draft: they are
   * only added to the repertoire with "Save variation". Going back keeps the line, so you can
   * step forward through it again.
   */
  const [line, setLine] = useState<LineMove[]>([]);
  const [ply, setPly] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  /** Move whose comment is being written (id), or null. */
  const [commentEdit, setCommentEdit] = useState<number | null>(null);
  /**
   * Filling the missing moves one after the other (opened from a missing move: the badge of the
   * list, ?gap=1, or "Coups manquants"): saving a line that fills one opens the next one.
   */
  const [gapMode, setGapMode] = useState(false);
  /** Missing moves ignored here ("fen uci"): hidden at once, before the report is computed again. */
  const [ignoredNow, setIgnoredNow] = useState<ReadonlySet<string>>(new Set());
  const isIgnored = (g: Gap) => !!g.move && ignoredNow.has(`${g.fen} ${g.move.uci}`);

  // The chapter open (?chapter=, else the first one): its moves are on the board, edits go to it.
  const [params, setParams] = useSearchParams();
  const chapterParam = params.get('chapter');
  const chapter = data?.chapters.find((c) => c.id === chapterParam) ?? data?.chapters[0];
  const chapterId = chapter?.id ?? '';
  const root = chapter ? chapterRoot(chapter) : START_FEN;
  const chapterMoves = useMemo(() => (data?.moves ?? []).filter((m) => m.chapterId === chapterId), [data, chapterId]);
  const rep = useMemo(() => new Repertoire(data?.color ?? 'white', chapterMoves), [data?.color, chapterMoves]);
  /** All the chapters together: what the repertoire covers (missing moves). */
  const whole = useMemo(() => new Repertoire(data?.color ?? 'white', data?.moves ?? []), [data]);
  /** The chapter the line on the board belongs to. */
  const [lineOf, setLineOf] = useState('');
  const selectChapter = (id: string, moves: PlayedMove[] = []) => {
    setLine(moves);
    setPly(moves.length);
    setLineOf(id);
    setNotice(null);
    setParams({ chapter: id }, { replace: true });
  };
  // Another chapter opened by a link or the browser's back button: its start.
  useEffect(() => {
    if (!chapterId || chapterId === lineOf || params.get('fen') || params.get('line')) return;
    if (lineOf) {
      setLine([]);
      setPly(0);
    }
    setLineOf(chapterId);
  }, [chapterId]);

  // ?fen=<position>: open the editor on that position (e.g. from the training progress), in the
  // chapter given or the first one containing it. ?line=<uci,uci,…>: on that line from the
  // initial position (after ?fen=: from that position), in the chapter given or the one following
  // it the furthest; moves not in the chapter are a draft (e.g. a hole from the gap finder).
  const openFen = params.get('fen');
  const openLine = params.get('line');
  useEffect(() => {
    if ((!openFen && !openLine) || !data) return;
    if (params.get('gap')) setGapMode(true);
    const color = data.color;
    const given = data.chapters.find((c) => c.id === chapterParam);
    const ucis = openLine ? openLine.split(',') : [];
    let target: { chapter: typeof given & {}; line: PlayedMove[] } | null = null;
    if (openFen) {
      if (given) {
        const path = pathTo(new Repertoire(color, data.moves.filter((m) => m.chapterId === given.id)), openFen, chapterRoot(given));
        target = path && { chapter: given, line: path };
      } else target = chapterForPosition(color, data.chapters, data.moves, openFen);
      if (target) target.line = [...target.line, ...playLine(target.line.at(-1)?.toFen ?? chapterRoot(target.chapter), ucis)];
    } else {
      const line = playLine(START_FEN, ucis);
      if (given) {
        const start = chapterRoot(given) === START_FEN ? 0 : line.findIndex((m) => m.toFen === chapterRoot(given)) + 1;
        target = { chapter: given, line: line.slice(start) };
      } else target = chapterForLine(color, data.chapters, data.moves, line);
    }
    if (target) selectChapter(target.chapter.id, target.line);
    else setParams(chapter ? { chapter: chapter.id } : {}, { replace: true });
  }, [openFen, openLine, data]);
  const stored = useMemo(() => new Map(chapterMoves.map((m) => [`${m.fromFen} ${m.uci}`, m])), [chapterMoves]);
  /** The chapter open without its paused moves, and the positions it reaches from its start. */
  const activeChapter = useMemo(() => {
    const active = new Repertoire(data?.color ?? 'white', chapterMoves.filter((m) => !m.paused));
    return { rep: active, reach: active.reachable(root) };
  }, [data?.color, chapterMoves, root]);
  const storedMove = (m: LineMove) => stored.get(`${m.fromFen} ${m.uci}`);
  const fen = line[ply - 1]?.toFen ?? root;
  // The moves trained (main first), then the paused ones.
  const atFen = rep.movesAt(fen) as StoredMove[];
  const here = [...atFen.filter((m) => !m.paused), ...atFen.filter((m) => m.paused)];
  const shown = line.slice(0, ply);
  const unsaved = shown.filter((m) => !rep.has(m.fromFen, m.uci));

  const ex = explorerParams(me, speed, range);
  const explorer = useQuery({
    queryKey: ['explorer', fen, ex.speeds, ex.ratings],
    queryFn: () => api.explorer(fen, ex.speeds, ex.ratings),
    staleTime: Infinity,
    retry: false,
  });

  // The moves changed: the repertoire, and what depends on it (missing moves, lines to train, list).
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['repertoire', id] }),
      qc.invalidateQueries({ queryKey: ['gaps'] }),
      qc.invalidateQueries({ queryKey: ['training-summary'] }),
      qc.invalidateQueries({ queryKey: ['repertoires'] }),
    ]);
  const saveLine = useMutation({
    mutationFn: () => api.saveLine(chapterId, shown.map((m) => m.uci)),
    onSuccess: async (r) => {
      // The missing moves of the repertoire still open before saving, most frequent first.
      const open = (gapReport.data?.[whole.color]?.gaps ?? []).filter((g) => g.repertoireId === id && !isIgnored(g) && !coveredBy(whole, g));
      await refresh();
      const saved = t(`${plural(r.added, 'coup enregistré', 'coups enregistrés')}.`, `${plural(r.added, 'move saved', 'moves saved')}.`);
      const fresh = qc.getQueryData<RepertoireDetail>(['repertoire', id]);
      if (gapMode && fresh) {
        const now = new Repertoire(fresh.color, fresh.moves);
        if (open.some((g) => coveredBy(now, g))) {
          const left = open.filter((g) => !coveredBy(now, g));
          if (left.length) {
            openGap(left[0]!, fresh);
            return setNotice(t(`${saved} Coup manquant suivant (${left.length} restant${left.length > 1 ? 's' : ''}).`, `${saved} Next missing move (${left.length} left).`));
          }
          setGapMode(false);
          return setNotice(t(`${saved} Tous les coups manquants sont comblés.`, `${saved} Every missing move is filled.`));
        }
      }
      setNotice(saved);
    },
  });
  /**
   * "Save variation". A line ending on an opponent move without my answer (none in the chapter
   * either): asked first, it is most often an answer forgotten.
   */
  const save = () => {
    const end = shown.at(-1)?.toFen;
    if (end && turnOf(end) === rep.color && !rep.movesAt(end).length) {
      const ok = confirm(
        t(
          'La variante se termine sur un coup adverse, sans réponse de votre part. L’enregistrer quand même ?',
          'The variation ends on an opponent move, without an answer of yours. Save it anyway?',
        ),
      );
      if (!ok) return;
    }
    saveLine.mutate();
  };
  const ignoreGap = useMutation({
    mutationFn: (g: Gap) => api.ignoreGap(g.fen, g.move!.uci),
    onMutate: (g) => setIgnoredNow((s) => new Set(s).add(`${g.fen} ${g.move!.uci}`)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['gaps'] }),
  });
  const restoreGaps = useMutation({
    mutationFn: api.restoreGaps,
    onSuccess: async () => {
      setIgnoredNow(new Set());
      await qc.invalidateQueries({ queryKey: ['gaps'] });
    },
  });
  const renameRep = useMutation({
    mutationFn: (name: string) => api.renameRepertoire(id, name),
    onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['repertoires'] })]),
  });
  const toggleActive = useMutation({
    mutationFn: () => api.setRepertoireActive(id, !data!.active),
    onSuccess: () =>
      Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['repertoires'] }), qc.invalidateQueries({ queryKey: ['training-summary'] })]),
  });
  const deleteRep = useMutation({
    mutationFn: () => api.deleteRepertoire(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['repertoires'] });
      navigate('/repertoires');
    },
  });
  const deleteMove = useMutation({ mutationFn: (m: StoredMove) => api.deleteMove(chapterId, m.id), onSuccess: refresh });
  /**
   * Main and paused moves, set by dragging the moves of a position (see dropMove). Shown at once
   * (same rules as updateMove: the main move is never paused, pausing it hands the main line to
   * the first other move still trained), then reloaded.
   */
  const arrange = useMutation({
    mutationFn: async (patches: MovePatch[]) => {
      for (const p of patches) await api.updateMove(chapterId, p.m.id, p.patch);
    },
    onMutate: (patches) => {
      qc.setQueryData<RepertoireDetail>(['repertoire', id], (d) => d && { ...d, moves: patches.reduce(applyPatch, d.moves) });
    },
    onSettled: refresh,
  });
  /**
   * A move dropped in the list of its position: at the top of the moves trained, it becomes the
   * main move; in the paused zone, it is paused (it and what only follows it are not trained).
   */
  const dropMove = (moveId: number, target: DropTarget) => {
    const m = here.find((x) => x.id === moveId);
    if (!m) return;
    const active = here.filter((x) => !x.paused);
    if (target.zone === 'paused') {
      if (!m.paused) arrange.mutate([{ m, patch: { paused: true } }]);
    } else if (target.index === 0) {
      if (m.paused || !m.isMain) arrange.mutate([{ m, patch: { isMain: true } }]);
    } else if (m.paused) {
      arrange.mutate([{ m, patch: { paused: false } }]);
    } else if (active[0]?.id === m.id && active[1]) {
      // The main move dropped lower: the move now on top becomes the main one.
      arrange.mutate([{ m: active[1], patch: { isMain: true } }]);
    }
  };
  // A long press on a move chip (right click with a mouse): its actions (pause, delete).
  const [acting, setActing] = useState<StoredMove | null>(null);
  const setComment = useMutation({
    mutationFn: ({ m, comment }: { m: StoredMove; comment: string }) => api.updateMove(chapterId, m.id, { comment: comment || null }),
    onSuccess: refresh,
  });
  /** The move's annotation (!, ?, !!…; null: none); its other NAGs (positions, ±…) are kept. */
  const setNag = useMutation({
    mutationFn: ({ m, nag }: { m: StoredMove; nag: number | null }) => {
      const nags = [...(m.nags ?? []).filter((n) => !(n in MOVE_NAGS)), ...(nag ? [nag] : [])];
      return api.updateMove(chapterId, m.id, { nags: nags.length ? nags : null });
    },
    onSuccess: refresh,
  });

  // On a phone the line is one row scrolled sideways: the current move kept in view.
  const pathRef = useRef<HTMLDivElement>(null);
  /** Moves hidden on the left / right of the row (an ellipsis shows it). */
  const [cut, setCut] = useState({ left: false, right: false });
  const measureCut = () => {
    const box = pathRef.current;
    const left = !!box && box.scrollLeft > 2;
    const right = !!box && box.scrollLeft + box.clientWidth < box.scrollWidth - 2;
    setCut((c) => (c.left === left && c.right === right ? c : { left, right }));
  };
  useEffect(() => {
    // After the layout: saving a line changes the width of its moves (unsaved ones are in italics).
    const frame = requestAnimationFrame(() => {
      const box = pathRef.current;
      if (box && box.scrollWidth > box.clientWidth) {
        const current = box.querySelector<HTMLElement>('.current');
        const left = current?.offsetLeft ?? 0;
        if (!current) box.scrollLeft = 0;
        else if (left < box.scrollLeft) box.scrollLeft = left - 8;
        else if (left + current.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = left + current.offsetWidth - box.clientWidth + 8;
      }
      measureCut();
    });
    return () => cancelAnimationFrame(frame);
  }, [ply, line, chapterMoves]);
  /** Back to the start: the line is cleared (its unsaved moves dropped, after a confirmation). */
  const restart = () => {
    const draft = line.some((m) => !rep.has(m.fromFen, m.uci));
    if (draft && !confirm(t('Abandonner les coups non enregistrés de cette ligne ?', 'Drop the unsaved moves of this line?'))) return;
    setLine([]);
    setPly(0);
    setNotice(null);
  };
  const goTo = (n: number) => {
    setPly(Math.max(0, Math.min(n, line.length)));
    setNotice(null);
  };

  /** Plays a move at the cursor: follows the line if it is the next move, else branches off. */
  const play = useCallback(
    (uci: string) => {
      setNotice(null);
      if (line[ply]?.uci === uci) return setPly(ply + 1);
      const move = playUci(fen, uci);
      if (!move) return;
      setLine([...line.slice(0, ply), move]);
      setPly(ply + 1);
    },
    [line, ply, fen],
  );

  /**
   * The next moves: the line's next move if it is not saved yet, then the repertoire moves (main
   * first). → plays the line's next move, else the main one (outlined on the board).
   */
  const options: PlayedMove[] = useMemo(() => {
    const next = line[ply];
    const draft = next && !here.some((m) => m.uci === next.uci) ? [next] : [];
    return [...draft, ...here];
  }, [line, ply, here]);
  const selected = Math.max(0, options.findIndex((m) => m.uci === line[ply]?.uci));
  /** Number of the next move, as in the line ("2." for White, "2…" for Black). */
  const moveNumber = ply % 2 === 0 ? `${ply / 2 + 1}.` : `${(ply + 1) / 2}…`;

  const forward = useCallback(() => {
    const move = options[selected];
    if (move) play(move.uci);
  }, [options, selected, play]);

  /** Drops the unsaved moves: back to the longest saved part of the line. */
  const discard = () => {
    const firstUnsaved = line.findIndex((m) => !rep.has(m.fromFen, m.uci));
    if (firstUnsaved < 0) return;
    setLine(line.slice(0, firstUnsaved));
    setPly(Math.min(ply, firstUnsaved));
  };

  /** Plays several moves from the cursor (engine line), following the current line if it matches. */
  const playMoves = (moves: PlayedMove[]) => {
    setNotice(null);
    const follows = moves.every((m, i) => line[ply + i]?.uci === m.uci);
    if (!follows) setLine([...line.slice(0, ply), ...moves]);
    setPly(ply + moves.length);
  };
  const jumpTo = (moves: PlayedMove[]) => {
    setNotice(null);
    setLine(moves);
    setPly(moves.length);
  };
  /** Opens a line from the initial position, in the chapter following it the furthest. */
  const openLineOf = (ucis: string[], d: RepertoireDetail) => {
    const target = chapterForLine(d.color, d.chapters, d.moves, playLine(START_FEN, ucis));
    if (target && target.chapter.id !== chapterId) selectChapter(target.chapter.id, target.line);
    else if (target) jumpTo(target.line);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  /** Opens a missing move: the position where it is played (its orange arrow, the move not played yet). */
  const openGap = (g: Gap, d: RepertoireDetail) => openLineOf(g.ucis, d);

  // One button for the analysis (on for the browser session only): Lichess at my level (on the
  // opponent's turn, each of its moves scored from the search after it; its box follows the
  // likely lines or not) and Stockfish both run, in one table (Éval column).
  const [analysisOn, toggleAnalysis] = useAnalysisToggle();
  const levelOn = analysisOn;
  const engineOn = analysisOn;
  const engine = useTableEngine(fen, engineOn);
  const [levelDepth, onDepth] = useLevelDepth();
  const depth = levelOn ? levelDepth : 0;
  const myTurn = rep.isMyTurn(fen);
  const level = useBestMoves(fen, ex.speeds, ex.ratings, depth > 0, depth, rep.color);
  const levelBest = depth > 0 && myTurn ? topLevelMove(level.data) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input')) return;
      if (e.key.startsWith('Arrow')) e.preventDefault(); // no page scroll
      if (e.key === 'ArrowLeft') goTo(ply - 1);
      if (e.key === 'ArrowRight') forward();
      if (e.key === 'Home') restart();
      if (e.key === 'End') goTo(line.length);
      if (e.key === 'a' || e.key === 'e' || e.key === 'n') toggleAnalysis(!analysisOn);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Warn before leaving the page with an unsaved variation.
  const hasDraft = line.some((m) => !rep.has(m.fromFen, m.uci));
  /** The saved moves of the line up to the cursor (all of them when there is no draft). */
  const shownStored = shown.map(storedMove).filter((m): m is StoredMove => !!m);
  useEffect(() => {
    if (!hasDraft) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft]);

  /** Missing moves here (gap finder, "Coups manquants"): the opponent moves not prepared yet. */
  const missingHere = useMemo(
    () =>
      new Set(
        (gapReport.data?.[rep.color]?.gaps ?? [])
          .filter((g) => g.repertoireId === id && g.fen === fen && g.move && !isIgnored(g) && !whole.has(fen, g.move.uci))
          .map((g) => g.move!.uci),
      ),
    [gapReport.data, whole, id, fen, ignoredNow],
  );

  /**
   * Arrows: green = move in the repertoire (thicker = more popular), orange = missing move (gap
   * finder) or next move of the line not saved yet.
   */
  const shapes = useMemo<DrawShape[]>(() => {
    const ed = explorer.data?.data;
    const total = ed ? totalGames(ed) : 0;
    const share = new Map((ed?.moves ?? []).map((m) => [m.uci, total ? totalGames(m) / total : 0]));
    // Thicker = played more often; repertoire arrows never get thinner than 9.
    const width = (s: number, min = 5) => Math.max(min, Math.round(5 + 11 * s));
    const arrow = (uci: string, brush: ArrowKind | 'outline', lineWidth: number): DrawShape => ({
      orig: uci.slice(0, 2) as Key,
      dest: uci.slice(2, 4) as Key,
      brush,
      modifiers: { lineWidth },
    });
    // The move → plays gets a thin white outline (same colour and width: width encodes popularity).
    const next = options[selected];
    const out = here
      .filter((m) => m.uci !== next?.uci)
      .map((m) => arrow(m.uci, m.paused ? 'paused' : 'repertoire', width(share.get(m.uci) ?? 0, 9)));
    // Drawn last, so its outline stays visible over an arrow on the same line.
    if (next) {
      const w = width(share.get(next.uci) ?? 0, 9);
      const saved = here.find((m) => m.uci === next.uci);
      // Paused: no white outline (it would show through the almost transparent arrow).
      if (saved?.paused) out.push(arrow(next.uci, 'pausedNext', w));
      else out.push(arrow(next.uci, 'outline', w + OUTLINE_EXTRA), arrow(next.uci, !saved ? 'nextDraft' : 'next', w));
    }
    // Orange: the missing moves only (those of "Coups manquants").
    for (const uci of missingHere) if (uci !== next?.uci) out.push(arrow(uci, 'popular', width(share.get(uci) ?? 0)));
    // Level under engine: wider, so both show when they agree.
    if (levelBest) out.push(arrow(levelBest.uci, 'level', 6));
    const best = engineOn ? engine.lines[0]?.pv[0] : undefined;
    if (best) out.push(arrow(best.uci, 'engine', 4));
    return out;
  }, [explorer.data, rep, fen, here, engineOn, engine.lines[0]?.pv[0]?.uci, levelBest?.uci, options, selected, missingHere]);

  if (isLoading) return <p className="muted">{t('Chargement…', 'Loading…')}</p>;
  const colorReport = data ? gapReport.data?.[data.color] : undefined;
  // Without the holes the repertoire covers now (saved since the report: hidden at once, until the
  // report is computed again): the opponent move added (or a transposition), or my answer.
  const covered = (g: Gap) => coveredBy(whole, g);
  // Only the holes of the chapter open, reached without its paused moves: an opponent move missing
  // where it has replies, or no answer after one of its opponent moves.
  const inChapter = (g: Gap) => activeChapter.reach.has(g.fen) && (!g.move || activeChapter.rep.movesAt(g.fen).length > 0);
  const holes = colorReport?.gaps.filter((g) => g.repertoireId === id && inChapter(g) && !isIgnored(g) && !covered(g));
  // Only those of the position on the board (its orange arrows) are listed.
  const holesHere = holes?.filter((g) => g.fen === fen) ?? [];
  const ignoredCount = (colorReport?.ignored?.[id] ?? 0) + (colorReport?.gaps.filter((g) => g.repertoireId === id && isIgnored(g)).length ?? 0);
  if (error || !data) return <p className="error">{t('Impossible de charger le répertoire.', 'Could not load the repertoire.')}</p>;

  const last = line[ply - 1];
  const lastStored = last ? storedMove(last) : undefined;

  return (
    <>
    <PageHeader
      back="/repertoires"
      title={data.name}
      subtitle={t(
        `${data.color === 'white' ? 'Blancs' : 'Noirs'} · ${plural(data.chapters.length, 'chapitre', 'chapitres')}${data.active ? '' : ' · en pause'}`,
        `${data.color === 'white' ? 'White' : 'Black'} · ${plural(data.chapters.length, 'chapter', 'chapters')}${data.active ? '' : ' · paused'}`,
      )}
      menu={[
        ...(ignoredCount > 0
          ? [{ label: t(`Rétablir ${plural(ignoredCount, 'coup manquant ignoré', 'coups manquants ignorés')}`, `Restore ${plural(ignoredCount, 'ignored missing move', 'ignored missing moves')}`), onClick: () => restoreGaps.mutate() }]
          : []),
        { label: t('Organiser les chapitres', 'Organise the chapters'), onClick: () => setOrganizing(true) },
        ...(data.lichessStudyId
          ? [
              { label: t('Mettre à jour depuis Lichess', 'Update from Lichess'), onClick: () => setSyncOpen(true) },
              { label: t('Pousser sur Lichess', 'Push to Lichess'), onClick: () => setPushOpen(true) },
              { label: t('Voir l’étude sur Lichess', 'See the study on Lichess'), onClick: () => window.open(`https://lichess.org/study/${data.lichessStudyId}`, '_blank', 'noopener') },
            ]
          : [
              { label: t('Lier à une étude Lichess…', 'Link to a Lichess study…'), onClick: () => setSyncOpen(true) },
              { label: t('Créer l’étude sur Lichess', 'Create the study on Lichess'), onClick: () => setPushOpen(true) },
            ]),
        { label: data.active ? t('Mettre le répertoire en pause', 'Pause the repertoire') : t('Reprendre l’entraînement', 'Resume training'), onClick: () => toggleActive.mutate() },
        {
          label: t('Renommer le répertoire', 'Rename the repertoire'),
          onClick: () => {
            const next = prompt(t('Nouveau nom', 'New name'), data.name)?.trim();
            if (next && next !== data.name) renameRep.mutate(next);
          },
        },
        {
          label: t('Supprimer le répertoire', 'Delete the repertoire'),
          danger: true,
          onClick: () =>
            confirm(t(`Supprimer le répertoire « ${data.name} », ses chapitres et tous leurs coups ?`, `Delete the repertoire “${data.name}”, its chapters and all their moves?`)) && deleteRep.mutate(),
        },
      ]}
    />
    {syncOpen && <StudySyncDialog repertoire={data} onClose={() => setSyncOpen(false)} />}
    {pushOpen && <PushDialog repertoire={data} onClose={() => setPushOpen(false)} />}
    {acting && (
      <MoveActionsDialog
        san={acting.san}
        nags={acting.nags}
        paused={!!acting.paused}
        where={t('de ce chapitre', 'from this chapter')}
        onPause={(pause) => arrange.mutate([{ m: acting, patch: { paused: pause } }])}
        onDelete={() => deleteMove.mutate(acting)}
        onClose={() => setActing(null)}
      />
    )}
    <div className="editor">
      <div className="editor-board">
        <ChapterBar
          repertoireId={id}
          color={data.color}
          chapters={data.chapters}
          moves={data.moves}
          current={chapter}
          boardFen={ply > 0 && unsaved.length === 0 ? fen : null}
          onSelect={(c) => selectChapter(c)}
          onMovedAway={(to, c) => navigate(`/r/${to}?chapter=${c}`)}
          organizing={organizing}
          onOrganize={setOrganizing}
          trainTo={`/r/${id}/train${data.chapters.length > 1 && chapterId ? `?chapter=${chapterId}` : ''}`}
        />
        <div className="board-row">
          {/* Always there (empty when the engine is off): toggling it does not resize the board. */}
          <EvalBar line={engineOn ? engine.lines[0] : undefined} orientation={data.color} off={!engineOn} />
          <Board fen={fen} orientation={data.color} lastMove={last?.uci} lastMoveNags={lastStored?.nags} shapes={shapes} onMove={play} />
        </div>
        {/* Back: ◀ (or a click on a move of the line, ←). Forward: the green button (or →). */}
        <div className="nav editor-nav">
          <AnalysisToggle enabled={analysisOn} onToggle={toggleAnalysis} />
          <button type="button" className="play-back" onClick={() => goTo(ply - 1)} disabled={ply === 0} title={t('Coup précédent (←)', 'Previous move (←)')} aria-label={t('Coup précédent', 'Previous move')}>
            <Icon name="back" size={24} />
          </button>
          <button type="button" className="play-next" onClick={forward} disabled={!options[selected]} title={t('Coup suivant (→)', 'Next move (→)')} aria-label={t('Coup suivant', 'Next move')}>
            <Icon name="chevron" size={26} />
          </button>
        </div>
        {/* The analysis: the Lichess moves at my level with Stockfish's evaluation (Éval column). */}
        {analysisOn && (
        <ExplorerPanel
          fen={fen}
          color={rep.color}
          inRep={(uci) => rep.has(fen, uci)}
          nagsOf={(uci) => rep.movesAt(fen).find((m) => m.uci === uci)?.nags}
          stats={explorer.data}
          error={explorer.error}
          loading={explorer.isLoading}
          onPick={play}
          isMissing={(uci) => missingHere.has(uci)}
          firstMoveNumber={ply}
          onPlay={playMoves}
          level={{
            data: level.data,
            loading: level.isLoading,
            error: level.error,
            depth,
            maxDepth: LEVEL_STEPS,
            onDepth,
            myTurn,
            range: rangeLabel(ex.ratings),
            engineBest: engineOn ? engine.lines[0]?.pv[0]?.uci : undefined,
          }}
          engine={{ byMove: engine.byMove, best: engine.lines[0], lines: engine.lines, depth: engine.depth, maxDepth: engine.maxDepth, onShown: engine.onShown }}
        />
        )}
      </div>

      <div className="editor-side">
        {chapter && (
        <section className="panel">
          {line.length > 0 && (
          <div className="line-row">
          <div className={`path-clip ${cut.left ? 'cut-left' : ''} ${cut.right ? 'cut-right' : ''}`}>
          <div className="moves-path" ref={pathRef} onScroll={measureCut}>
            {line.map((m, i) => {
              const stored = rep.movesAt(m.fromFen).find((x) => x.uci === m.uci);
              // Paused: the move itself (pause icon), and what follows it on the line (greyed).
              const pausedAt = line.findIndex((x) => rep.movesAt(x.fromFen).some((y) => y.uci === x.uci && y.paused));
              return (
                <button
                  key={i}
                  className={[
                    'link',
                    stored ? '' : 'unsaved',
                    i === ply - 1 ? 'current' : '',
                    i >= ply ? 'ahead' : '',
                    pausedAt >= 0 && i >= pausedAt ? 'in-paused' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => goTo(i + 1)}
                  title={stored?.paused ? t('En pause : ce coup et sa suite ne sont pas entraînés', 'Paused: this move and what follows are not trained') : stored ? t('Dans votre répertoire', 'In your repertoire') : t('Pas enregistré', 'Not saved')}
                >
                  {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
                  {stored?.paused && <span className="pause-mark"><Icon name="pause" size={13} /></span>}
                  <San san={m.san} nags={stored?.nags} />
                </button>
              );
            })}
          </div>
          </div>
          {lastStored && !lastStored.comment && commentEdit !== lastStored.id && (
            <Button size="sm" variant="ghost" icon="pencil" title={t(`Commenter ou annoter ${lastStored.san} (!, ?…)`, `Comment or annotate ${lastStored.san} (!, ?…)`)} onClick={() => setCommentEdit(lastStored.id)} />
          )}
          {/* Train from the position on the board (saved line only). */}
          {ply > 0 && unsaved.length === 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon="target"
              title={t('S’entraîner à partir d’ici', 'Train from here')}
              to={`/r/${id}/train?${new URLSearchParams({ mode: 'review', ...(data.chapters.length > 1 ? { chapter: chapterId } : {}), from: fen })}`}
            />
          )}
          <Button size="sm" variant="ghost" icon="close" title={t('Revenir au début (efface la ligne)', 'Back to the start (clears the line)')} onClick={restart} />
          </div>
          )}

          {unsaved.length > 0 && (
            <div className="draft">
              <button className="primary" disabled={saveLine.isPending} onClick={save}>
                {t('Enregistrer la variante', 'Save the line')}
              </button>
              <Button size="sm" variant="ghost" onClick={discard}>{t('Annuler', 'Cancel')}</Button>
            </div>
          )}
          {notice && <p className="muted small-text">{notice}</p>}
          {shownStored.some((m) => m.paused) && (
            <p className="muted small-text">
              <Icon name="pause" size={12} /> {t('Ligne en pause : pas entraînée.', 'Line paused: not trained.')}
            </p>
          )}
          {saveLine.error && <p className="error">{saveLine.error.message}</p>}
          {lastStored && (
            <CommentNote
              key={lastStored.id}
              move={lastStored}
              editing={commentEdit === lastStored.id}
              onEdit={(on) => setCommentEdit(on ? lastStored.id : null)}
              onSave={(comment) => setComment.mutate({ m: lastStored, comment })}
              onNag={(nag) => setNag.mutate({ m: lastStored, nag })}
            />
          )}
          {here.length === 0 && !hasDraft && (
            <>
              <p className="muted">{t('Jouez des coups pour continuer la variante.', 'Play moves to continue the line.')}</p>
              {/* End of the line on my turn: what to play next, from the engine or at my level. */}
              {myTurn && !analysisOn && (
                <div className="suggest-start muted small-text">
                  {t('Suggérer un coup :', 'Suggest a move:')}
                  <Button size="sm" icon="analysis" onClick={() => toggleAnalysis(true)}>{t('Analyser', 'Analyse')}</Button>
                </div>
              )}
            </>
          )}
          {(here.length > 0 || (options[0] && !rep.has(options[0].fromFen, options[0].uci))) && (
            <MoveChips
              moves={here}
              draft={options[0] && !rep.has(options[0].fromFen, options[0].uci) ? options[0] : null}
              moveNumber={moveNumber}
              onPlay={play}
              onDrop={dropMove}
              onActions={setActing}
              onDiscardDraft={() => setLine(line.slice(0, ply))}
            />
          )}
        </section>
        )}


        <Suggestions
          gaps={holesHere}
          onIgnore={(g) => ignoreGap.mutate(g)}
          onOpen={(ucis) => {
            setGapMode(true);
            openLineOf(ucis, data);
          }}
        />



      </div>
    </div>
    </>
  );
}

/**
 * Comment of the move leading to the position: shown as text with a pencil to edit it (the
 * pencil to add one sits at the end of the line); the text area only appears while writing.
 */
type MovePatch = { m: StoredMove; patch: { isMain?: boolean; paused?: boolean } };

/** A main / paused change applied to the moves, by the rules of updateMove (same chapter, same position). */
function applyPatch(moves: StoredMove[], { m, patch }: MovePatch): StoredMove[] {
  const same = (x: StoredMove) => x.chapterId === m.chapterId && x.fromFen === m.fromFen;
  if (patch.isMain) return moves.map((x) => (x.id === m.id ? { ...x, isMain: true, paused: false } : same(x) ? { ...x, isMain: false } : x));
  if (patch.paused) {
    const wasMain = moves.find((x) => x.id === m.id)?.isMain;
    const heir = wasMain ? moves.find((x) => same(x) && x.id !== m.id && !x.paused) : undefined;
    return moves.map((x) => (x.id === m.id ? { ...x, isMain: false, paused: true } : x === heir ? { ...x, isMain: true } : x));
  }
  return moves.map((x) => (x.id === m.id ? { ...x, ...patch } : x));
}


/** The move annotations offered, from the best to the worst. */
const NAG_CHOICES = [3, 1, 5, 6, 2, 4];

/**
 * A missing move the repertoire covers now (saved since the report): the opponent move added (or
 * a transposition), or an answer where there was none.
 */
function coveredBy(whole: Repertoire, g: Gap): boolean {
  if (!g.move) return whole.movesAt(g.fen).length > 0;
  const after = playUci(g.fen, g.move.uci)?.toFen;
  return whole.has(g.fen, g.move.uci) || (!!after && whole.movesAt(after).length > 0);
}

function CommentNote({ move, editing, onEdit, onSave, onNag }: { move: StoredMove; editing: boolean; onEdit: (on: boolean) => void; onSave: (comment: string) => void; onNag: (nag: number | null) => void }) {
  const [text, setText] = useState(move.comment ?? '');
  const current = moveNag(move.nags);
  if (!editing) {
    if (!move.comment) return null;
    return (
      <div className="comment-note">
        <span className="comment">{move.comment}</span>
        <Button size="sm" variant="ghost" icon="pencil" title={t('Modifier le commentaire', 'Edit the comment')} onClick={() => onEdit(true)} />
      </div>
    );
  }
  const save = () => {
    if (text.trim() !== (move.comment ?? '')) onSave(text.trim());
    onEdit(false);
  };
  return (
    <div className="comment-box">
      {/* The move's annotation: saved at once; the one chosen again removes it. */}
      <div className="nag-picker" role="group" aria-label={t(`Annotation de ${move.san}`, `Annotation of ${move.san}`)}>
        {NAG_CHOICES.map((n) => {
          const nag = MOVE_NAGS[n]!;
          const on = current?.symbol === nag.symbol;
          return (
            <button key={n} type="button" className={`nag-choice nag-${nag.kind} ${on ? 'on' : ''}`} aria-pressed={on} title={on ? t(`Retirer « ${nag.label} »`, `Remove “${nag.label}”`) : nag.label} onClick={() => onNag(on ? null : n)}>
              {nag.symbol}
            </button>
          );
        })}
      </div>
      <textarea autoFocus placeholder={t(`Commentaire sur ${move.san}…`, `Comment on ${move.san}…`)} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
      <div className="row">
        <Button size="sm" variant="primary" onClick={save}>{t('Enregistrer', 'Save')}</Button>
        <Button size="sm" variant="ghost" onClick={() => (setText(move.comment ?? ''), onEdit(false))}>{t('Annuler', 'Cancel')}</Button>
      </div>
    </div>
  );
}
