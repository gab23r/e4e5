import { playSanOn, playUci, positionFromFen, START_FEN, totalGames, type Color, type PlayedMove } from '@e4e5/core';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, type Me, type MyGameRef, type ChapterMoveHere } from '../api';
import { Board } from '../components/Board';
import { EngineLines, EvalBar } from '../components/EnginePanel';
import { chapterLabel } from '../chapters';
import { lineText, parseMoves } from '../components/lineText';
import { useEngine } from '../engine/useEngine';
import { useGaps } from '../useGaps';
import { LEVEL_STEPS, topLevelMove, useBestMoves, useLevelDepth } from '../components/BestMoves';
import { ExplorerPanel } from '../components/ExplorerPanel';
import { AnalysisToggle, ToolCards, useAnalysisToggle } from '../components/ToolCards';
import { MoveTable } from '../components/MoveTable';
import { San } from '../components/Nag';
import { OpeningName } from '../components/OpeningName';
import { PausedZoneHeader } from '../components/PausedZoneHeader';
import { useMoveDrag, type DropTarget } from '../components/useMoveDrag';
import { useLongPress } from '../components/useLongPress';
import { MoveActionsDialog } from '../components/MoveActionsDialog';
import { useFlip } from '../components/useFlip';
import { lang, t } from '../i18n';
import { explorerParams, rangeLabel, speedsLabel, useSettings } from '../settings';
import { Icon, PageHeader, plural } from '../ui';

/** Moves from the initial position, as UCI, for links. */
const ucis = (line: PlayedMove[]) => line.map((m) => m.uci).join(',');

function lineFromUcis(text: string | null): PlayedMove[] {
  const line: PlayedMove[] = [];
  for (const uci of text ? text.split(',') : []) {
    const move = playUci(line.at(-1)?.toFen ?? START_FEN, uci);
    if (!move) break;
    line.push(move);
  }
  return line;
}

const STORAGE_KEY = 'explorer';
/** Last explorer state: the whole line (also the moves ahead of the cursor), cursor, orientation. */
interface Saved {
  line: string;
  ply: number;
  orientation: Color;
}

function fromUrl(params: URLSearchParams) {
  const line = lineFromUcis(params.get('line'));
  return { line, ply: line.length, orientation: (params.get('color') === 'black' ? 'black' : 'white') as Color };
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Saved | null;
    if (saved) {
      const line = lineFromUcis(saved.line || null);
      return { line, ply: Math.max(0, Math.min(saved.ply, line.length)), orientation: saved.orientation === 'black' ? 'black' : ('white' as Color) };
    }
  } catch {
    // ignore a corrupt entry
  }
  return { line: [] as PlayedMove[], ply: 0, orientation: 'white' as Color };
}

/**
 * Free exploration of any position: board, the moves of all your repertoires, Lichess
 * statistics of players of your level (violet card) and your own games (each move unfolds into
 * its games).
 */
export function Explorer({ me }: { me: Me }) {
  const { speed, range, gamesSpeeds, gamesDays } = useSettings();
  const ex = explorerParams(me, speed, range);
  const hasAccount = !!me.lichess || !!me.chesscom;
  const [params, setParams] = useSearchParams();
  // The line is kept in the URL (?line=e2e4,e7e5: reload and share keep the position) and in
  // localStorage, to find it again when coming back from another page without one.
  const [initial] = useState(() => (params.get('line') || params.get('color') ? fromUrl(params) : restore()));
  const [line, setLineState] = useState<PlayedMove[]>(initial.line);
  const [ply, setPlyState] = useState(initial.ply);
  const [orientation, setOrientation] = useState<Color>(initial.orientation);

  const sync = (l: PlayedMove[], p: number, o = orientation) => {
    setParams({ ...(p ? { line: ucis(l.slice(0, p)) } : {}), ...(o === 'black' ? { color: 'black' } : {}) }, { replace: true });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ line: ucis(l), ply: p, orientation: o } satisfies Saved));
  };
  // Shown in the URL at once when restored from localStorage.
  useEffect(() => sync(line, ply), []);
  const setLine = (l: PlayedMove[], p: number) => {
    setLineState(l);
    setPlyState(p);
    sync(l, p);
  };
  const goTo = (n: number) => {
    const p = Math.max(0, Math.min(n, line.length));
    setPlyState(p);
    sync(line, p);
  };
  const flip = () => {
    const o = orientation === 'white' ? 'black' : 'white';
    setOrientation(o);
    sync(line, ply, o);
  };

  const fen = line[ply - 1]?.toFen ?? START_FEN;
  const shown = line.slice(0, ply);

  /** Plays a move: follows the line if it is its next move, else branches off. */
  const play = (uci: string) => {
    if (line[ply]?.uci === uci) return goTo(ply + 1);
    const move = playUci(fen, uci);
    if (move) setLine([...shown, move], ply + 1);
  };

  const repMoves = useQuery({ queryKey: ['explorer-reps', fen], queryFn: () => api.chapterMovesAt(fen) });
  // The repertoires containing the position on the board (listed under the line).
  const posRepsAll = useQuery({ queryKey: ['explorer-pos-reps', fen], queryFn: () => api.positionChapters(fen) });
  const posReps = { data: posRepsAll.data?.filter((r) => r.color === orientation) };
  // Annotations of the moves of the line (from my repertoires): the moves of each position of the
  // line, same queries as above (cached), so going back and forth costs nothing.
  const pathPositions = useQueries({
    queries: line.map((m) => ({ queryKey: ['explorer-reps', m.fromFen], queryFn: () => api.chapterMovesAt(m.fromFen), staleTime: 60_000 })),
  });
  const pathNags = line.map(
    (m, i) => pathPositions[i]?.data?.find((r) => r.color === orientation && r.uci === m.uci && r.nags?.length)?.nags ?? null,
  );
  // One button for the analysis: Lichess at my level and Stockfish both run (ToolCards).
  const [analysisOn, toggleAnalysis] = useAnalysisToggle();
  const levelOn = analysisOn;
  const engineOn = analysisOn;
  const lichess = useQuery({
    queryKey: ['explorer', fen, ex.speeds, ex.ratings],
    queryFn: () => api.explorer(fen, ex.speeds, ex.ratings),
    staleTime: Infinity,
    retry: false,
    // The arrows of the popular moves, and the violet card (Lichess statistics merged with the search).
  });
  // My synced games (Lichess and Chess.com), with the games settings of the Parties page.
  const mine = useQuery({
    queryKey: ['explorer-mine', fen, orientation, gamesSpeeds, gamesDays],
    queryFn: () => api.myGames(fen, orientation, gamesSpeeds, gamesDays),
    enabled: hasAccount,
    retry: false,
    staleTime: 60_000,
  });

  const engine = useEngine(fen, engineOn);
  const best = engineOn ? engine.lines[0]?.pv[0] : undefined;
  // Moves at my level for the side to move (Lichess explorer), only when asked: the violet card.
  const [levelDepth, onDepth] = useLevelDepth();
  const depth = levelOn ? levelDepth : 0;
  // My side is the board's orientation: scores from it. The search at my level runs on both turns
  // (as in the repertoire editor): on the opponent's turn each of its moves is scored for me, the
  // search starting after it. The best move is drawn on my turn only.
  const myTurn = (fen.split(' ')[1] === 'b' ? 'black' : 'white') === orientation;
  const level = useBestMoves(fen, ex.speeds, ex.ratings, depth > 0, depth, orientation);
  const levelBest = depth > 0 && myTurn ? topLevelMove(level.data) : undefined;
  /** Plays an engine line from the current position (follows the line when it matches). */
  const playMoves = (moves: PlayedMove[]) => {
    const follows = moves.every((m, i) => line[ply + i]?.uci === m.uci);
    if (follows) goTo(ply + moves.length);
    else setLine([...shown, ...moves], ply + moves.length);
  };

  // The arrows (popular moves) follow the Lichess players of my level.
  const data = lichess.data?.data;
  // Only the repertoires of the side at the bottom of the board (White at the bottom: my White repertoires).
  const prepared = useMemo(
    () => groupByMove((repMoves.data ?? []).filter((r) => r.color === orientation)),
    [repMoves.data, orientation],
  );
  // The next moves in their order: the main one first, then the others trained, then the paused ones
  // (paused in every repertoire playing them). Main: one of my moves (the moves to remember, in the
  // repertoires of the side to move), main in each of them; an opponent's reply in my repertoires
  // of the other colour is never "main".
  const toMove: Color = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  /** The repertoires where this move is mine (side to move), trained. */
  const mineOf = (g: { reps: ChapterMoveHere[] }) => g.reps.filter((r) => r.color === toMove && !r.paused);
  const nextMoves = useMemo(() => {
    const all = [...prepared.values()].map((g) => {
      const mine = g.reps.filter((r) => r.color === toMove && !r.paused);
      return { ...g, main: mine.length > 0 && mine.every((r) => r.isMain), paused: g.reps.every((r) => r.paused) };
    });
    return [...all.filter((g) => !g.paused && g.main), ...all.filter((g) => !g.paused && !g.main), ...all.filter((g) => g.paused)];
  }, [prepared, toMove]);
  /** Forward (▶, →): follows the line if it goes on, else plays the first of the next moves. */
  const forward = () => {
    if (line[ply]) goTo(ply + 1);
    else if (nextMoves[0]) play(nextMoves[0].uci);
  };
  const qc = useQueryClient();
  /**
   * Main and paused moves, set by dragging the next moves (as in the editor), in every repertoire
   * playing the move. Shown at once (rules of the server), then reloaded.
   */
  const arrange = useMutation({
    mutationFn: async (patches: RowPatch[]) => {
      for (const p of patches) await api.updateMove(p.r.chapterId, p.r.id, p.patch);
    },
    onMutate: (patches) => {
      qc.setQueryData<ChapterMoveHere[]>(['explorer-reps', fen], (rows) => rows && patches.reduce(applyRowPatch, rows));
    },
    onSettled: (_data, _error, patches) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['explorer-reps'] }),
        ...[...new Set(patches.map((p) => p.r.repertoireId))].map((id) => qc.invalidateQueries({ queryKey: ['repertoire', id] })),
        qc.invalidateQueries({ queryKey: ['gaps'] }),
        qc.invalidateQueries({ queryKey: ['repertoires'] }),
      ]),
  });
  /** A next move dropped: on top, main; in the paused zone, paused; out of it, trained again. */
  const dropMove = (index: number, target: DropTarget) => {
    const g = nextMoves[index];
    if (!g) return;
    const active = nextMoves.filter((x) => !x.paused);
    if (target.zone === 'paused') {
      if (!g.paused) arrange.mutate(g.reps.filter((r) => !r.paused).map((r) => ({ r, patch: { paused: true } })));
    } else if (target.index === 0) {
      // Main: only in the repertoires where the move is mine.
      if (g.paused || !g.main) arrange.mutate(g.reps.filter((r) => r.color === toMove || r.paused).map((r) => ({ r, patch: r.color === toMove ? { isMain: true } : { paused: false } })));
    } else if (g.paused) {
      arrange.mutate(g.reps.filter((r) => r.paused).map((r) => ({ r, patch: { paused: false } })));
    } else if (active[0] === g && active[1]) {
      // The main move dropped lower: the move now on top becomes the main one.
      arrange.mutate(mineOf(active[1]).map((r) => ({ r, patch: { isMain: true } })));
    }
  };
  const { listRef, drag, handle } = useMoveDrag(dropMove);
  // A long press on a next move (right click with a mouse): its actions, in every repertoire
  // playing it (pause; delete, with what only follows it).
  const longPress = useLongPress();
  const [acting, setActing] = useState<(typeof nextMoves)[number] | null>(null);
  // The moves slide to their new place (paused: down into the paused zone; main: up).
  useFlip(listRef);
  const removeMove = useMutation({
    mutationFn: async (rows: ChapterMoveHere[]) => {
      for (const r of rows) await api.deleteMove(r.chapterId, r.id);
    },
    onSettled: (_data, _error, rows) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['explorer-reps'] }),
        qc.invalidateQueries({ queryKey: ['explorer-pos-reps'] }),
        ...[...new Set(rows.map((r) => r.repertoireId))].map((id) => qc.invalidateQueries({ queryKey: ['repertoire', id] })),
        qc.invalidateQueries({ queryKey: ['gaps'] }),
        qc.invalidateQueries({ queryKey: ['repertoires'] }),
      ]),
  });
  // Missing moves here (gap finder, any repertoire): the opponent moves not prepared yet, in orange.
  const gaps = useGaps(me);
  const missingHere = useMemo(
    () =>
      new Set(
        (gaps.data?.[orientation]?.gaps ?? [])
          .filter((g) => g.fen === fen && g.move && !prepared.has(g.move.uci))
          .map((g) => g.move!.uci),
      ),
    [gaps.data, fen, prepared, orientation],
  );
  const isMissing = (uci: string) => missingHere.has(uci);

  const shapes = useMemo<DrawShape[]>(() => {
    const total = data ? totalGames(data) : 0;
    const share = new Map((data?.moves ?? []).map((m) => [m.uci, total ? totalGames(m) / total : 0]));
    const width = (s: number, min = 5) => Math.max(min, Math.round(5 + 11 * s));
    const arrow = (uci: string, brush: string, lineWidth: number): DrawShape => ({
      orig: uci.slice(0, 2) as Key,
      dest: uci.slice(2, 4) as Key,
      brush,
      modifiers: { lineWidth },
    });
    // Paused (in every repertoire playing it, as in the list): almost transparent.
    const out = nextMoves.map((g) => arrow(g.uci, g.paused ? 'paused' : 'repertoire', width(share.get(g.uci) ?? 0, 9)));
    // Orange: the missing moves only (those of "Coups manquants").
    for (const uci of missingHere) out.push(arrow(uci, 'popular', width(share.get(uci) ?? 0)));
    if (levelBest) out.push(arrow(levelBest.uci, 'level', 6));
    if (best) out.push(arrow(best.uci, 'engine', 4));
    return out;
  }, [data, nextMoves, missingHere, best?.uci, levelBest?.uci]);

  /** The line typed instead of the moves path (pencil, or "/"). */
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input, select')) return;
      if (e.key.startsWith('Arrow')) e.preventDefault();
      if (e.key === 'ArrowLeft') goTo(ply - 1);
      if (e.key === 'ArrowRight') forward();
      if (e.key === 'Home') goTo(0);
      if (e.key === 'End') goTo(line.length);
      if (e.key === 'f') flip();
      if (e.key === 'a' || e.key === 'e' || e.key === 'n') toggleAnalysis(!analysisOn);
      if (e.key === '/') {
        e.preventDefault();
        setEditing(true);
      }
    };
    // A line pasted anywhere on the page (not in a field): go there.
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input, select')) return;
      const moves = parseMoves(e.clipboardData?.getData('text') ?? '');
      if (moves) setLine(moves, moves.length);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  });

  /** Replays a game: its moves become the line, at the current position when it goes through it. */
  const loadGame = useMutation({
    // My synced games (any site), from the database.
    mutationFn: api.myGameMoves,
    onSuccess: (g) => {
      const pos = positionFromFen(START_FEN);
      const moves: PlayedMove[] = [];
      for (const san of g.moves) {
        const m = playSanOn(pos, san);
        if (!m) break;
        moves.push(m);
      }
      const here = fen === START_FEN ? 0 : moves.findIndex((m) => m.toFen === fen) + 1;
      setLine(moves, here > 0 ? here : 0);
    },
  });

  const last = line[ply - 1];
  const accounts = [me.lichess && `Lichess ${me.lichess.username}`, me.chesscom && `Chess.com ${me.chesscom.username}`].filter(Boolean).join(', ');

  return (
    <>
    <PageHeader
      title={t('Explorer', 'Explore')}
      subtitle={t('Échiquier libre, vos répertoires, statistiques et moteur', 'Free board, your repertoires, statistics and engine')}
    />
    <div className="editor">
      <div className="editor-board">
        <OpeningName ucis={shown.map((m) => m.uci)} />
        <div className="board-row">
          {/* Always there (empty when the engine is off): toggling it does not resize the board. */}
          <EvalBar line={engineOn ? engine.lines[0] : undefined} orientation={orientation} off={!engineOn} />
          <Board fen={fen} orientation={orientation} lastMove={last?.uci} shapes={shapes} onMove={play} />
        </div>
        <div className="nav">
          <button onClick={() => goTo(0)} title={t('Début (Origine)', 'Start (Home)')}>⏮</button>
          <button onClick={() => goTo(ply - 1)} title={t('Reculer (←)', 'Back (←)')}>◀</button>
          <button onClick={forward} title={t('Avancer (→)', 'Forward (→)')}>▶</button>
          <button onClick={() => goTo(line.length)} title={t('Fin de la ligne (Fin)', 'End of the line (End)')}>⏭</button>
          <button onClick={flip} title={t('Retourner l’échiquier (f)', 'Flip the board (f)')}>⇅</button>
          <AnalysisToggle enabled={analysisOn} onToggle={toggleAnalysis} />
        </div>
        {/* The two tools in swipeable cards, one in view at a time (ToolCards). */}
        {analysisOn && (
        <ToolCards
          engine={
            (
              <EngineLines
                enabled={engineOn}
                lines={engine.lines}
                depth={engine.depth}
                maxDepth={engine.maxDepth}
                firstMoveNumber={ply}
                onPlay={playMoves}
              />
            )
          }
          level={
            (
            <ExplorerPanel
              fen={fen}
              color={orientation}
              inRep={(uci) => prepared.has(uci)}
              nagsOf={(uci) => prepared.get(uci)?.nags}
              stats={lichess.data}
              error={lichess.error}
              loading={lichess.isLoading}
              onPick={play}
              isMissing={isMissing}
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
                engineBest: best?.uci,
              }}
            />
            )
          }
        />
        )}
      </div>

      <div className="editor-side">
        <section className="panel">
          {editing ? (
            <LineInput
              initial={lineText(line.slice(0, ply))}
              onJump={(moves) => {
                setLine(moves, moves.length);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="moves-path">
              {line.length === 0 && <span className="muted">{t('Position initiale', 'Starting position')}</span>}
              {line.map((m, i) => (
                <button
                  key={i}
                  className={['link', i === ply - 1 ? 'current' : '', i >= ply ? 'ahead' : ''].filter(Boolean).join(' ')}
                  onClick={() => goTo(i + 1)}
                >
                  {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
                  <San san={m.san} nags={pathNags[i]} />
                </button>
              ))}
              <button className="line-edit" onClick={() => setEditing(true)} title={t('Taper ou coller une ligne (/)', 'Type or paste a line (/)')} aria-label={t('Taper ou coller une ligne', 'Type or paste a line')}>
                <Icon name="pencil" size={15} />
              </button>
            </div>
          )}
          {/* The repertoires containing the position on the board (a link opens each one here). */}
          {posReps.data && posReps.data.length === 0 && (
            <p className="muted small-text rep-none">
              {t(
                `Aucun répertoire ${orientation === 'white' ? 'Blancs' : 'Noirs'} ne contient cette position.`,
                `No ${orientation === 'white' ? 'White' : 'Black'} repertoire contains this position.`,
              )}
            </p>
          )}
          {posReps.data && posReps.data.length > 0 && (
            <div className="rep-tags rep-at">
              {[...posReps.data].sort((a, b) => chapterLabel(a).localeCompare(chapterLabel(b), lang, { sensitivity: 'base' })).map((r) => (
                <Link
                  key={r.chapterId}
                  className="rep-tag"
                  to={`/r/${r.repertoireId}?${new URLSearchParams({ chapter: r.chapterId, ...(shown.length ? { line: ucis(shown) } : {}) })}`}
                  title={t(
                    `Ouvrir ${chapterLabel(r)} sur cette position${r.moves ? ` (${r.moves} coup${r.moves > 1 ? 's' : ''} préparé${r.moves > 1 ? 's' : ''} ici)` : ' (fin de sa ligne)'}`,
                    `Open ${chapterLabel(r)} at this position${r.moves ? ` (${plural(r.moves, 'move', 'moves')} prepared here)` : ' (end of its line)'}`,
                  )}
                >
                  <span className={`dot inline ${r.color}`} /> {chapterLabel(r)}
                </Link>
              ))}
            </div>
          )}
          {/* The next moves of my repertoires here: annotation colour, comment; a click anywhere on the row plays the move.
              The grip: drag on top to make it main, into the paused zone to pause it (as in the editor). */}
          {nextMoves.length > 0 && (
            <ul className={`rep-moves next-moves ${drag ? 'dragging-list' : ''}`} ref={listRef}>
              {nextMoves.map((g, i) => {
                const zone = g.paused ? 'paused' : 'active';
                // Drop indicator: a line before the row the dragged move would land before.
                const others = nextMoves.filter((x, k) => (x.paused ? 'paused' : 'active') === zone && k !== drag?.id);
                const rank = others.indexOf(g);
                const dropBefore = !!drag && drag.id !== i && drag.zone === 'active' && zone === 'active' && rank === drag.index;
                const dropAfter = !!drag && drag.id !== i && drag.zone === 'active' && zone === 'active' && rank === others.length - 1 && drag.index === others.length;
                // One comment per text (the same move commented in several repertoires).
                const comments = [...new Map(g.reps.filter((r) => r.comment).map((r) => [r.comment!, r])).values()];
                return (
                  <Fragment key={g.uci}>
                    {i === nextMoves.findIndex((x) => x.paused) && (
                      <PausedZoneHeader target={drag?.zone === 'paused'} dropAbove={drag?.zone === 'active' && !nextMoves.some((x, k) => !x.paused && k !== drag.id)} />
                    )}
                    <li
                      data-zone={zone}
                      data-id={i}
                      data-flip={`${fen}|${g.uci}`}
                      className={['next-move', 'clickable', g.paused ? 'paused' : '', drag?.id === i ? 'dragging' : '', dropBefore ? 'drop-before' : '', dropAfter ? 'drop-after' : '']
                        .filter(Boolean)
                        .join(' ')}
                      style={drag?.id === i ? { transform: `translateY(${drag.dy}px)` } : undefined}
                      title={t(
                        `Jouer ${g.san} (${g.reps.map(chapterLabel).join(', ')}) · appui long : mettre en pause, supprimer`,
                        `Play ${g.san} (${g.reps.map(chapterLabel).join(', ')}) · long press: pause, delete`,
                      )}
                      onClick={() => play(g.uci)}
                      {...longPress(() => setActing(g))}
                    >
                      <div className="move-main">
                        <button className="link san">
                          <span className="move-num">{ply % 2 === 0 ? `${ply / 2 + 1}.` : `${(ply + 1) / 2}…`}</span>
                          <San san={g.san} nags={g.nags} />
                        </button>
                        {g.main && nextMoves.filter((x) => !x.paused).length > 1 && <span className="badge">{t('principal', 'main')}</span>}
                        {comments.map((r) => (
                          <div key={r.chapterId} className="comment move-comment">
                            {comments.length > 1 && <span className="muted">{t(`${chapterLabel(r)} : `, `${chapterLabel(r)}: `)}</span>}
                            {r.comment}
                          </div>
                        ))}
                      </div>
                      <span className="grip" title={t('Glisser : en haut, coup principal ; en bas, en pause', 'Drag: to the top, main move; to the bottom, paused')} {...handle(i)}>
                        <Icon name="grip" size={16} />
                      </span>
                    </li>
                  </Fragment>
                );
              })}
              {drag && !nextMoves.some((x) => x.paused) && (
                <PausedZoneHeader target={drag.zone === 'paused'} dropAbove={drag.zone === 'active' && !nextMoves.some((_, k) => k !== drag.id)} />
              )}
            </ul>
          )}
          {acting && (
            <MoveActionsDialog
              san={acting.san}
              nags={acting.nags}
              paused={acting.paused}
              where={t('de tous les répertoires', 'from all repertoires')}
              onPause={(pause) => arrange.mutate(acting.reps.filter((r) => r.paused !== pause).map((r) => ({ r, patch: { paused: pause } })))}
              onDelete={() => removeMove.mutate(acting.reps)}
              onClose={() => setActing(null)}
            />
          )}
          <p className="muted small-text keys">
            {t(
              <>
                <kbd>←</kbd><kbd>→</kbd> naviguer · <kbd>f</kbd> retourner · <kbd>a</kbd> analyse · <kbd>/</kbd> taper une ligne (ou collez-la)
              </>,
              <>
                <kbd>←</kbd><kbd>→</kbd> navigate · <kbd>f</kbd> flip · <kbd>a</kbd> analysis · <kbd>/</kbd> type a line (or paste it)
              </>,
            )}
          </p>
        </section>


        {/* My games in this position: the moves I played, each one unfolding into its games. */}
        <section className="panel">
          <h3>{t('Mes parties', 'My games')}</h3>
          {!hasAccount ? (
            <p className="muted">
              {t(
                <>
                  Liez Lichess ou indiquez votre pseudo Chess.com dans <Link to="/account#accounts">Mon compte</Link> pour voir vos propres parties.
                </>,
                <>
                  Link Lichess or enter your Chess.com username in <Link to="/account#accounts">My account</Link> to see your own games.
                </>,
              )}
            </p>
          ) : (
            <p className="muted small-text">
              {t(
                <>
                  Vos parties synchronisées ({accounts}) avec les{' '}
                  <strong>{orientation === 'white' ? 'Blancs' : 'Noirs'}</strong>, {speedsLabel(gamesSpeeds)}, {gamesDays ? `${gamesDays} derniers jours` : 'toutes'} (
                  <Link to="/settings">Parties analysées</Link>) — retournez l’échiquier pour vos parties avec les {orientation === 'white' ? 'Noirs' : 'Blancs'}.
                  {mine.data && ply >= mine.data.maxPly && ` Seuls les ${mine.data.maxPly / 2} premiers coups sont indexés.`}
                </>,
                <>
                  Your synced games ({accounts}) with{' '}
                  <strong>{orientation === 'white' ? 'White' : 'Black'}</strong>, {speedsLabel(gamesSpeeds)}, {gamesDays ? `last ${gamesDays} days` : 'all'} (
                  <Link to="/settings">Analysed games</Link>) — flip the board for your games with {orientation === 'white' ? 'Black' : 'White'}.
                  {mine.data && ply >= mine.data.maxPly && ` Only the first ${mine.data.maxPly / 2} moves are indexed.`}
                </>,
              )}
            </p>
          )}
          {mine.isLoading && <p className="muted">{t('Chargement de vos parties…', 'Loading your games…')}</p>}
          {mine.error && <ErrorText error={mine.error} />}
          {mine.data && (
            <MoveTable
              data={mine.data.data}
              color={orientation}
              inRep={(uci) => prepared.has(uci)}
              nagsOf={(uci) => prepared.get(uci)?.nags}
              onPick={play}
              missing={isMissing}
              detail={(uci) => <GameRows games={mine.data!.recentGames.filter((g) => g.uci === uci)} onOpen={(id) => loadGame.mutate(id)} />}
            />
          )}
          {loadGame.isPending && <p className="muted small-text">{t('Chargement de la partie…', 'Loading the game…')}</p>}
          {loadGame.error && <ErrorText error={loadGame.error} />}
        </section>
      </div>
    </div>
    </>
  );
}

/** Repertoire moves of the position grouped by move: which repertoires play it. */
function groupByMove(rows: ChapterMoveHere[]) {
  const out = new Map<string, { uci: string; san: string; nags: number[] | null; reps: ChapterMoveHere[] }>();
  for (const r of rows) {
    const g = out.get(r.uci) ?? { uci: r.uci, san: r.san, nags: null, reps: [] };
    // The annotation of the first repertoire that has one.
    if (!g.nags?.length && r.nags?.length) g.nags = r.nags;
    g.reps.push(r);
    out.set(r.uci, g);
  }
  return out;
}

const RESULT = { white: '1-0', black: '0-1' } as const;

/** My games, one per row (the most recent first): tap one to replay it on the board. */
function GameRows({ games, onOpen }: { games: MyGameRef[]; onOpen: (id: string) => void }) {
  if (!games.length) return <p className="muted small-text">{t('Aucune partie.', 'No games.')}</p>;
  return (
    <table className="lines games">
      <tbody>
        {games.map((g) => (
          <tr key={g.id} className="clickable" onClick={() => onOpen(g.id)} title={t('Rejouer cette partie sur l’échiquier', 'Replay this game on the board')}>
            <td>
              {g.white.name} <span className="muted">{g.white.rating}</span>
            </td>
            <td>
              {g.black.name} <span className="muted">{g.black.rating}</span>
            </td>
            <td>{g.winner ? RESULT[g.winner] : '½-½'}</td>
            <td className="muted">{[g.speed, g.month].filter(Boolean).join(' · ')}</td>
            <td>
              <a
                href={g.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={g.source === 'chesscom' ? t('Ouvrir sur Chess.com', 'Open on Chess.com') : t('Ouvrir sur Lichess', 'Open on Lichess')}
              >
                ↗
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ErrorText({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 404) return <p className="muted">{t('Aucune statistique pour cette position.', 'No statistics for this position.')}</p>;
  return <p className="error small-text">{error instanceof Error ? error.message : String(error)}</p>;
}

/**
 * The moves path turned into a field (pencil or "/"): the line so far, selected, to edit or
 * replace by typed or pasted moves ("1. e4 c5 2. Nf3", UCI too). Enter goes there, Escape or
 * leaving the field cancels.
 */
function LineInput({ initial, onJump, onCancel }: { initial: string; onJump: (moves: PlayedMove[]) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState(false);
  return (
    <form
      className="line-input"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return onJump([]);
        const moves = parseMoves(text);
        if (moves) onJump(moves);
        else setError(true);
      }}
    >
      <input
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onBlur={onCancel}
        placeholder="1. e4 c5 2. Nf3"
        aria-label={t('Aller à une ligne : coups de la position initiale', 'Go to a line: moves from the starting position')}
        aria-invalid={error}
      />
      {error && <span className="error small-text">{t('Coups illégaux ou mal écrits (exemple : 1. e4 c5 2. Nf3).', 'Illegal or badly written moves (example: 1. e4 c5 2. Nf3).')}</span>}
    </form>
  );
}

/** A main / paused change of one move of a chapter. */
type RowPatch = { r: ChapterMoveHere; patch: { isMain?: boolean; paused?: boolean } };

/** The change applied to the moves of the position, by the rules of updateMove, per chapter. */
function applyRowPatch(rows: ChapterMoveHere[], { r, patch }: RowPatch): ChapterMoveHere[] {
  const sameRep = (x: ChapterMoveHere) => x.chapterId === r.chapterId;
  if (patch.isMain) return rows.map((x) => (x.id === r.id ? { ...x, isMain: true, paused: false } : sameRep(x) ? { ...x, isMain: false } : x));
  if (patch.paused) {
    const wasMain = rows.find((x) => x.id === r.id)?.isMain;
    const heir = wasMain ? rows.find((x) => sameRep(x) && x.id !== r.id && !x.paused) : undefined;
    return rows.map((x) => (x.id === r.id ? { ...x, isMain: false, paused: true } : x === heir ? { ...x, isMain: true } : x));
  }
  return rows.map((x) => (x.id === r.id ? { ...x, ...patch } : x));
}
