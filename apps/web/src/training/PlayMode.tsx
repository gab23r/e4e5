import { chooseReply, pathTo, Repertoire, START_FEN, type Color, type ExplorerResponse, type RepMove, type TrainingPosition } from '@e4e5/core';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Grade } from '../api';
import { Board } from '../components/Board';
import { BotAvatar } from '../components/BotAvatar';
import { OpeningName } from '../components/OpeningName';
import { AnswerTimer, useAnswerClock } from './AnswerTimer';
import { answerArrows, REPLY_MS, savedSession, saveSession } from './common';
import { LineDone, QuizLine, useMyMovesHere } from './DrillParts';
import { outcomeOf } from './Feedback';
import type { Source } from './useTrainingSources';
import { t } from '../i18n';
import { Icon } from '../ui';

/** Waiting time for statistics before choosing a reply without them. */
const STATS_TIMEOUT_MS = 1500;
/** Pause on a finished line before starting the next one. */
const NEXT_LINE_MS = 700;

/** `lost`: a move missed twice, the game is lost (the answer shown, the bot gloats). */
type Phase = 'opponent' | 'ask' | 'end' | 'lost';

/**
 * The repertoires of one colour, played together: a line goes on in whichever repertoire has its
 * sequel (1. e4 e5 2. Nf3 of the Scotch also stands in the Philidor and Petrov ones).
 */
interface Side {
  id: string;
  color: Color;
  /** Every move of these repertoires (one per position and move). */
  rep: Repertoire;
  positions: TrainingPosition[];
  pausedAt: (fen: string) => RepMove[];
  cardOf: Source['cardOf'];
  /** The repertoire a move of mine is recorded in (the first having it). */
  sourceOf: (fen: string, uci: string) => Source;
  /** The repertoire a position is in (the first having moves there), to open it in the editor. */
  sourceAt: (fen: string) => Source;
}

function sideOf(color: Color, group: Source[], rep: Repertoire): Side {
  const positions = new Map<string, TrainingPosition>();
  for (const s of group) for (const p of s.positions) if (!positions.has(p.fen)) positions.set(p.fen, p);
  return {
    id: `side:${color}`,
    color,
    rep,
    positions: [...positions.values()],
    pausedAt: (fen) => group.flatMap((s) => s.pausedAt(fen)),
    cardOf: (fen, uci) => group[0]!.cardOf(fen, uci),
    sourceOf: (fen, uci) => group.find((s) => s.rep.has(fen, uci)) ?? group[0]!,
    sourceAt: (fen) => group.find((s) => s.rep.movesAt(fen).length > 0) ?? group[0]!,
  };
}

/** The merged graph of each colour, built again only when a repertoire changes (not after an answer). */
function useSides(sources: Source[]): Side[] {
  const reps = useRef<{ list: Repertoire[]; merged: Map<Color, Repertoire> } | null>(null);
  const list = sources.map((s) => s.rep);
  if (!reps.current || reps.current.list.length !== list.length || reps.current.list.some((r, i) => r !== list[i])) {
    const merged = new Map<Color, Repertoire>();
    for (const s of sources) {
      const rep = merged.get(s.color) ?? new Repertoire(s.color);
      for (const m of s.rep.all()) rep.add(m);
      merged.set(s.color, rep);
    }
    reps.current = { list, merged };
  }
  const merged = reps.current.merged;
  return useMemo(() => [...merged].map(([color, rep]) => sideOf(color, sources.filter((s) => s.color === color), rep)), [sources, merged]);
}

interface LineState {
  side: Side;
  fen: string;
  history: RepMove[];
  phase: Phase;
  mistakes: number;
  revealed: boolean;
  /** The pieces to move are shown (Indice). */
  hinted: boolean;
  /** Wrong moves played in this position (UCI, in order): recorded with the answer. */
  wrong?: string[];
}

/** Score of the session: lines played, my moves, asked (learnt) and right first time. */
export interface PlayScore {
  lines: number;
  moves: number;
  asked: number;
  clean: number;
}

/** Ply of a position (from its FEN): where the line of the quiz starts. */
const plyOf = (fen: string) => {
  const [, turn, , , , full] = fen.split(' ');
  return (Math.max(1, Number(full) || 1) - 1) * 2 + (turn === 'b' ? 1 : 0);
};

/**
 * Playing against a bot of my level ("Jouer contre…"): the app plays the opponent, choosing among
 * the repertoire replies as often as Lichess players of the selected level play them (their real
 * frequency); I answer with my repertoire moves until the end of the line, learnt or not. Every
 * answer counts in the training: found at once, right; after a mistake or with help, seen. A move
 * missed twice loses the game.
 */
export function PlayMode({
  sources,
  root,
  speeds,
  ratings,
  onReview,
  onScore,
  sessionKey,
  bot,
}: {
  sources: Source[];
  root: string;
  speeds: string[];
  ratings: number[];
  /** `played`: the wrong moves played before (UCI, in order). */
  onReview: (source: Source, fen: string, uci: string, grade: Grade, played?: string[]) => void;
  /** The score of the session (shown in the page header, like the review's). */
  onScore?: (score: PlayScore) => void;
  /** The scope of the session: put aside under this key when the page is left, taken up on return. */
  sessionKey?: string;
  /** The opponent (its name and face, above the board): it talks (`intro` first), at the end of a line says a word, and I replay. */
  bot?: { name: string; intro: string };
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  /**
   * The whole repertoire, whatever is learnt: every line is played to its end. The repertoires of
   * a colour are played together (`Side`).
   */
  const sides = useSides(sources);
  /** Where a line goes after a move: opponent to play, my turn, or the end of the line. */
  const after = (side: Side, fen: string): Phase => (side.rep.movesAt(fen).length === 0 ? 'end' : side.rep.isMyTurn(fen) ? 'ask' : 'opponent');
  const playable = useMemo(() => sides.filter((s) => after(s, root) !== 'end').map((s) => ({ s, size: Math.max(1, s.positions.length) })), [sides, root]);
  /** The session put aside when the page was left (e.g. for the explorer): the same line, the same score. */
  const [saved] = useState(() => {
    const s = sessionKey ? savedSession<{ line: LineState | null; score: PlayScore }>(sessionKey) : undefined;
    if (!s) return undefined;
    const side = s.line && sides.find((x) => x.id === s.line!.side.id);
    // A finished line (or a colour no longer here): the next one.
    const line = s.line && side && s.line.phase !== 'end' && s.line.phase !== 'lost' ? { ...s.line, side } : null;
    return { line, score: s.score };
  });
  const [line, setLine] = useState<LineState | null>(saved?.line ?? null);
  const [score, setScore] = useState<PlayScore>(saved?.score ?? { lines: 0, moves: 0, asked: 0, clean: 0 });
  const kept = useRef({ line, score });
  kept.current = { line, score };
  useEffect(() => {
    if (!sessionKey) return;
    return () => saveSession(sessionKey, kept.current);
  }, [sessionKey]);
  useEffect(() => onScore?.(score), [score, onScore]);
  const token = useRef(0);

  const statsQuery = useCallback(
    (fen: string) => ({
      queryKey: ['explorer', fen, speeds, ratings],
      queryFn: () => api.explorer(fen, speeds, ratings),
      staleTime: Infinity,
      retry: false,
    }),
    [speeds, ratings],
  );

  /** Statistics of a position, or null if unknown / too slow. */
  const statsOf = (fen: string): Promise<ExplorerResponse | null> =>
    Promise.race([
      qc.fetchQuery(statsQuery(fen)).then((r) => r.data).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STATS_TIMEOUT_MS)),
    ]);

  const startLine = useCallback(() => {
    token.current++;
    if (!playable.length) return setLine(null);
    // Colours are picked in proportion to the size of their repertoires.
    const total = playable.reduce((n, p) => n + p.size, 0);
    let r = Math.random() * total;
    const side = (playable.find((p) => (r -= p.size) < 0) ?? playable[0]!).s;
    setLine({ side, fen: root, history: [], phase: after(side, root), mistakes: 0, revealed: false, hinted: false });
  }, [playable, root]);

  // Latest version (sources change after each review), without restarting timers.
  const startRef = useRef(startLine);
  startRef.current = startLine;

  useEffect(() => {
    if (!line) startLine();
  }, [line, startLine]);

  // Opponent's turn: pick a reply (weighted by statistics), then play it.
  useEffect(() => {
    if (line?.phase !== 'opponent') return;
    const my = ++token.current;
    const started = Date.now();
    void statsOf(line.fen).then((stats) => {
      // As often as the players of my level play it (its real frequency).
      const reply = chooseReply(line.side.rep.movesAt(line.fen), stats, Math.random, { power: 1 });
      const wait = Math.max(0, REPLY_MS - (Date.now() - started));
      setTimeout(() => {
        if (token.current !== my) return;
        if (!reply) return setLine({ ...line, phase: 'end' });
        const phase = after(line.side, reply.toFen);
        setLine({
          ...line,
          fen: reply.toFen,
          history: [...line.history, reply],
          phase,
          mistakes: 0,
          revealed: false,
          hinted: false,
        });
      }, wait);
    });
  }, [line?.phase, line?.fen]);

  // End of a line (won or lost): the bot says a word and waits for "Rejouer" (a line ended at once,
  // or without a bot: the next one shortly; lost, a little later to see the answer).
  useEffect(() => {
    if (line?.phase !== 'end' && line?.phase !== 'lost') return;
    setScore((s) => ({ ...s, lines: s.lines + 1 }));
    if (bot && (line.history.length > 0 || line.phase === 'lost')) return;
    const t = setTimeout(() => startRef.current(), line.phase === 'lost' ? NEXT_LINE_MS * 4 : NEXT_LINE_MS);
    return () => clearTimeout(t);
  }, [line?.phase]);
  // Enter (or space) replays at the end of a line.
  useEffect(() => {
    if (!bot || (line?.phase !== 'end' && line?.phase !== 'lost')) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      startRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bot, line?.phase]);

  const answers = line && line.phase === 'ask' ? line.side.rep.movesAt(line.fen) : [];
  const elsewhere = useMyMovesHere(line?.phase === 'ask' ? line.fen : undefined, line?.side.color ?? 'white');

  // While I think, fetch the statistics of the positions my answers lead to.
  useEffect(() => {
    for (const a of answers) void qc.prefetchQuery(statsQuery(a.toFen));
  }, [line?.fen, line?.phase]);

  /** `helped`: played with the Solution button (counted as helped). */
  const play = (uci: string, helped = false) => {
    if (!line || line.phase !== 'ask') return;
    const answer = answers.find((m) => m.uci === uci);
    // A move of mine put on pause, or of another of my repertoires: not a mistake, try again.
    if (!answer && (line.side.pausedAt(line.fen).some((m) => m.uci === uci) || elsewhere(uci))) return 'retry';
    if (!answer) {
      setLine(miss(line, uci));
      return false;
    }
    // Any of my moves is accepted, and counts in the training as in the review, learnt or not:
    // found at once, right (good); after a mistake or with help, seen (again).
    const outcome = outcomeOf(false, line.mistakes, line.revealed || line.hinted || helped);
    const grade: Grade = outcome === 'correct' ? 'good' : 'again';
    onReview(line.side.sourceOf(line.fen, answer.uci), line.fen, answer.uci, grade, line.wrong);
    setScore((s) => ({
      ...s,
      moves: s.moves + 1,
      asked: s.asked + (outcome === 'new' ? 0 : 1),
      clean: s.clean + (outcome === 'correct' ? 1 : 0),
    }));
    setLine({ ...line, fen: answer.toFen, history: [...line.history, answer], phase: after(line.side, answer.toFen), mistakes: 0, revealed: false, hinted: false, wrong: [] });
  };

  /**
   * A miss (wrong move, time up, Abandon): the first one shows nothing more (Abandon shows the
   * answer); the second loses the game: my main move here is recorded as seen, the answer shown.
   */
  const miss = (l: LineState, uci?: string, reveal = false): LineState => {
    const wrong = uci ? [...(l.wrong ?? []), uci] : (l.wrong ?? []);
    if (l.mistakes + 1 < 2) return { ...l, mistakes: l.mistakes + 1, revealed: l.revealed || reveal, wrong };
    const moves = l.side.rep.movesAt(l.fen);
    const main = moves.find((m) => m.isMain) ?? moves[0];
    if (main) onReview(l.side.sourceOf(l.fen, main.uci), l.fen, main.uci, 'again', wrong);
    setScore((s) => ({ ...s, asked: s.asked + 1 }));
    return { ...l, mistakes: l.mistakes + 1, revealed: true, wrong, phase: 'lost' };
  };

  /** Indice: the pieces to move. */
  const hint = () => {
    if (!line || line.phase !== 'ask' || line.hinted || line.revealed) return;
    setLine({ ...line, hinted: true });
  };
  /** Abandon: the answer shown, the move counted as missed (as when the time is up); I play it to go on. */
  const giveUp = () => {
    if (!line || line.phase !== 'ask' || line.revealed) return;
    setLine(miss(line, undefined, true));
  };
  /** Rejouer: another line at once (nothing recorded). */
  const skip = () => startRef.current();
  /** Répertoire: the position in the editor of the repertoire it is in. */
  const toRepertoire = () => {
    if (!line) return;
    const source = line.side.sourceAt(line.fen);
    const moves = pathTo(source.rep, line.fen) ?? [...(root === START_FEN ? [] : (pathTo(line.side.rep, root) ?? [])), ...line.history];
    navigate(`/r/${source.id}?${new URLSearchParams({ line: moves.map((m) => m.uci).join(',') })}`);
  };

  // The answer clock (Paramètres › Temps pour répondre): time up counts as a mistake, the answer is shown.
  const clock = useAnswerClock(line?.phase === 'ask' && !line.revealed, `${line?.side.id}|${line?.history.length}|${score.lines}`, () =>
    { if (line?.phase === 'ask') setLine(miss(line, undefined, true)); },
  );

  const shapes = useMemo<DrawShape[]>(() => {
    if (line?.phase === 'lost') return answerArrows(line.side.rep.movesAt(line.fen));
    if (line?.phase !== 'ask') return [];
    if (line.revealed) return answerArrows(answers);
    if (line.hinted) return answers.map((m) => ({ orig: m.uci.slice(0, 2) as Key, brush: 'repertoire' }));
    return [];
  }, [line?.phase, line?.revealed, line?.hinted, line?.fen]);

  if (!playable.length) {
    return (
      <div className="panel done">
        <h3>{t('Aucune ligne à jouer', 'No line to play')}</h3>
        <p className="muted">
          {t('Ajoutez des coups à vos répertoires (ou reprenez un répertoire en pause) pour jouer vos lignes.', 'Add moves to your repertoires (or resume a paused one) to play your lines.')}
        </p>
      </div>
    );
  }

  return (
    <div className="editor play-screen">
      <div className={`editor-board${clock.paused ? ' paused' : ''}${line?.phase === 'lost' ? ' lost' : ''}${bot && line?.phase === 'end' && line.history.length > 0 ? ' won' : ''}`}>
        {bot ? (
          <BotTalk
            name={bot.name}
            intro={bot.intro}
            phase={line?.phase}
            first={score.lines === 0}
            ended={!!line && line.history.length > 0}
          />
        ) : (
          <OpeningName ucis={line?.history.map((m) => m.uci) ?? []} />
        )}
        <Board
          fen={line?.fen ?? root ?? START_FEN}
          orientation={line?.side.color ?? playable[0]!.s.color}
          lastMove={line?.history.at(-1)?.uci}
          shapes={shapes}
          onMove={line?.phase === 'ask' && !clock.paused ? (uci) => play(uci) : undefined}
        />
        {clock.paused && (
          <button className="pause-overlay" onClick={() => clock.setPaused(false)}>
            ▶ {t('Reprendre', 'Resume')}
          </button>
        )}
        {line?.phase === 'end' && line.history.length > 0 && !bot && <LineDone text={t('Fin de ce que vous connaissez', 'End of what you know')} />}
        {bot && <OpeningName ucis={line?.history.map((m) => m.uci) ?? []} />}
        <AnswerTimer clock={clock} />
        {/* Under the board: the line. */}
        <QuizLine moves={line?.history ?? []} firstPly={plyOf(root)} />
      </div>
      {/* At the bottom of the screen (phone): Indice, Abandon, Rejouer and Répertoire. */}
      <div className="play-actions">
        <button type="button" onClick={hint} disabled={line?.phase !== 'ask' || clock.paused || line.hinted || line.revealed} title={t('Montrer la pièce à jouer', 'Show the piece to move')}>
          <Icon name="bulb" size={24} />
          {t('Indice', 'Hint')}
        </button>
        <button type="button" onClick={giveUp} disabled={line?.phase !== 'ask' || clock.paused || line.revealed} title={t('Voir la réponse (coup compté comme manqué)', 'See the answer (move counted as missed)')}>
          <Icon name="flag" size={24} />
          {t('Abandon', 'Give up')}
        </button>
        <button type="button" onClick={skip} title={t('Rejouer une nouvelle ligne', 'Play a new line')}>
          <Icon name="replay" size={24} />
          {t('Rejouer', 'Replay')}
        </button>
        <button type="button" onClick={toRepertoire} disabled={!line} title={t('Ouvrir cette position dans votre répertoire', 'Open this position in your repertoire')}>
          <Icon name="book" size={24} />
          {t('Répertoire', 'Repertoire')}
        </button>
      </div>
    </div>
  );
}

/** What the bot says when I reach the end of my line: always fun, always asking for another game. */
const BOT_LINES: readonly [fr: string, en: string][] = [
  ['Félicitations, tu m’as eu dans l’ouverture !', 'Congratulations, you got me in the opening!'],
  ['Je suis à court de théorie, je change d’armes…', 'I’m out of theory, switching weapons…'],
  ['Bien joué, je vais mieux me préparer la prochaine fois.', 'Well played, I’ll prepare better next time.'],
  ['Hé ! Tu as lu le même livre que moi ?', 'Hey! Did you read the same book as me?'],
  ['Ok, ok… celle-là tu la connais par cœur. On en refait une ?', 'Ok, ok… you know that one by heart. Another one?'],
  ['Ma préparation s’arrête ici. La tienne, visiblement non !', 'My preparation stops here. Yours clearly doesn’t!'],
  ['Je retourne réviser mes fiches. Revanche ?', 'Back to my flashcards. Rematch?'],
  ['Impressionnant. Je n’ai plus de pièges en réserve.', 'Impressive. I’m out of traps.'],
  ['Tu joues ces coups comme un métronome !', 'You play these moves like a metronome!'],
  ['Pas mal du tout. Mais je n’ai pas dit mon dernier mot !', 'Not bad at all. But I’m not done yet!'],
  ['Zut, je pensais te surprendre. Encore une ?', 'Darn, I thought I’d surprise you. One more?'],
  ['Théorie maîtrisée. Je note, je note…', 'Theory mastered. Noted, noted…'],
  ['Tu es sûr que ce n’est pas toi le bot ?', 'Are you sure you’re not the bot?'],
  ['Allez, une dernière… promis, après j’arrête.', 'Come on, one last one… I promise, then I stop.'],
];

/** What the bot says when I miss a move twice and lose the game: teasing, never mean, asking for a rematch. */
const BOT_WINS: readonly [fr: string, en: string][] = [
  ['Gagné ! Tu as oublié ta préparation à la maison ?', 'I win! Did you leave your preparation at home?'],
  ['Hop, dans mon piège ! La flèche verte, c’était le bon coup.', 'Gotcha! The green arrow was the right move.'],
  ['Cette fois c’est moi qui gagne. Revanche ?', 'This time I win. Rematch?'],
  ['Deux fois à côté… je prends la victoire !', 'Missed twice… I’ll take the win!'],
  ['Ah, ce coup-là il faudra le revoir. On recommence ?', 'Ah, that move needs another look. Again?'],
  ['Je savais que tes fiches avaient un trou ici !', 'I knew your notes had a hole right here!'],
  ['Victoire du bot ! Note bien la flèche pour la prochaine fois.', 'Bot wins! Note the arrow for next time.'],
  ['Pas grave, même les grands maîtres oublient leur théorie.', 'No worries, even grandmasters forget their theory.'],
  ['1-0 pour moi. Tu prends ta revanche tout de suite ?', '1-0 to me. Want your revenge right now?'],
  ['Oups ! Ta mémoire a fait une gaffe. On rejoue ?', 'Oops! Your memory blundered. Play again?'],
  ['Je n’en reviens pas, j’ai gagné ! Ça n’arrivera plus, hein ?', 'I can’t believe I won! It won’t happen again, right?'],
  ['Le bon coup était juste là… à toi de jouer la revanche.', 'The right move was right there… your turn for revenge.'],
];

/** One message, never the same twice in a row (per list). */
const lastSaid = new Map<readonly unknown[], number>();
function pick(lines: readonly [string, string][]): [string, string] {
  const last = lastSaid.get(lines) ?? -1;
  let i = Math.floor(Math.random() * (lines.length - 1));
  if (i >= last && last >= 0) i++;
  lastSaid.set(lines, i);
  return lines[i]!;
}

/**
 * The bot above the board, its face and a speech bubble: first what it is about (`intro`), then a
 * word while we play; at the end of a line (won or lost) its comment (Rejouer at the bottom, or Enter).
 */
function BotTalk({
  name,
  intro,
  phase,
  first,
  ended,
}: {
  name: string;
  intro: string;
  phase: Phase | undefined;
  first: boolean;
  ended: boolean;
}) {
  const result = phase === 'lost' ? 'lost' : phase === 'end' && ended ? 'won' : null;
  // A new message for each result (kept while it is shown).
  const said = useMemo(() => (result === 'lost' ? pick(BOT_WINS) : result === 'won' ? pick(BOT_LINES) : null), [result]);
  const text = said ? t(said[0], said[1]) : first ? intro : phase === 'opponent' ? t('Voyons voir…', 'Let me see…') : t('À toi de jouer !', 'Your move!');
  return (
    <div className="bot-talk">
      <BotAvatar name={name} size={56} />
      <div className={`bot-bubble${result ? ` ${result}` : ''}`} role="status" key={said ? said[0] : 'talk'}>
        <p>{text}</p>
      </div>
    </div>
  );
}
