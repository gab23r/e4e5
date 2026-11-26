/**
 * Merges the statistics of several months (stats.db files built by build.ts, one per month) into
 * one stats.db: per position, the counters of every month added up (games and moves, per speed
 * and rating bucket). A position is in a month's file when it was played at least `--min` times
 * that month (every speed and level together): a month where it was rarer adds nothing to it.
 *
 *   pnpm --filter stats merge <month.db>... --out stats.db [--max-moves 30]
 *
 * The files are read in key order side by side (their rows are sorted by key): the merge streams,
 * whatever the number of months. Each position keeps its `--max-moves` most played moves.
 */
import { rmSync, statSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { decodePositionCounts, encodePositionStats, type CellCounts, type PositionCounts } from '@e4e5/core';

const { values: opts, positionals: inputs } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, 'max-moves': { type: 'string', default: '30' } },
});
if (!inputs.length || !opts.out) {
  console.error('Usage: pnpm --filter stats merge <month.db>... --out stats.db [--max-moves 30]');
  process.exit(1);
}
const MAX_MOVES = Number(opts['max-moves']);
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

type Meta = Record<string, unknown>;
interface Source {
  path: string;
  meta: Meta;
  rows: Iterator<{ key: bigint; data: Uint8Array }>;
  head: { key: bigint; data: Uint8Array } | null;
}

const sources: Source[] = inputs.map((path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  const meta = Object.fromEntries(
    (db.prepare('SELECT name, value FROM meta').all() as { name: string; value: string }[]).map((r) => [r.name, JSON.parse(r.value) as unknown]),
  );
  // Signed 64-bit order: the order of the INTEGER PRIMARY KEY, the one the rows are stored in.
  const select: StatementSync = db.prepare('SELECT key, data FROM stats ORDER BY key');
  select.setReadBigInts(true);
  const rows = (select.iterate() as IterableIterator<{ key: bigint; data: Uint8Array }>)[Symbol.iterator]();
  const first = rows.next();
  return { path, meta, rows, head: first.done ? null : first.value };
});

/** The months of a file (YYYY-MM), from its meta. */
const monthsOf = (meta: Meta) =>
  ((meta.months ?? []) as string[]).map((m) => /(20\d{2}-(0[1-9]|1[0-2]))(?!\d)/.exec(m)?.[1]).filter((m): m is string => !!m);
const months = [...new Set(sources.flatMap((s) => monthsOf(s.meta)))].sort();
if (months.length !== sources.length) throw new Error(`Mois attendus un par fichier : ${months.join(', ')} pour ${sources.length} fichiers`);

/** Adds the counters of `from` into `into`. */
function addCells(into: CellCounts, from: CellCounts) {
  for (const [cell, [w, d, b]] of from) {
    const x = into.get(cell);
    if (x) (x[0] += w), (x[1] += d), (x[2] += b);
    else into.set(cell, [w, d, b]);
  }
}
const gamesOf = (c: CellCounts) => [...c.values()].reduce((n, [w, d, b]) => n + w + d + b, 0);

rmSync(opts.out, { force: true });
const out = new DatabaseSync(opts.out);
out.exec(`
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;
  PRAGMA page_size = 8192;
  CREATE TABLE stats (key INTEGER PRIMARY KEY, data BLOB NOT NULL) WITHOUT ROWID;
  CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
  BEGIN;
`);
const insert = out.prepare('INSERT INTO stats (key, data) VALUES (?, ?)');

let written = 0;
let inSeveral = 0;
let movesDropped = 0;
for (;;) {
  // The smallest key among the heads of the files.
  let key: bigint | null = null;
  for (const s of sources) if (s.head && (key === null || s.head.key < key)) key = s.head.key;
  if (key === null) break;
  const parts: PositionCounts[] = [];
  for (const s of sources) {
    if (s.head?.key !== key) continue;
    parts.push(decodePositionCounts(s.head.data));
    const next = s.rows.next();
    s.head = next.done ? null : next.value;
  }
  let data: Uint8Array;
  if (parts.length === 1) data = encodePositionStats(parts[0]!);
  else {
    inSeveral++;
    const total: CellCounts = new Map();
    const moves = new Map<number, CellCounts>();
    for (const p of parts) {
      addCells(total, p.total);
      for (const m of p.moves) {
        let cells = moves.get(m.move);
        if (!cells) moves.set(m.move, (cells = new Map()));
        addCells(cells, m.cells);
      }
    }
    const sorted = [...moves].map(([move, cells]) => ({ move, cells, n: gamesOf(cells) })).sort((a, b) => b.n - a.n);
    movesDropped += Math.max(0, sorted.length - MAX_MOVES);
    data = encodePositionStats({ total, moves: sorted.slice(0, MAX_MOVES).map(({ move, cells }) => ({ move, cells })) });
  }
  insert.run(key, data);
  if (++written % 1_000_000 === 0) log(`${written.toLocaleString('fr-FR')} positions écrites`);
}

const meta = {
  months,
  until: sources.map((s) => String(s.meta.until ?? '')).sort().at(-1) ?? null,
  min: Math.max(...sources.map((s) => Number(s.meta.min ?? 0))),
  gate: sources[0]!.meta.gate ?? null,
  plies: Math.min(...sources.map((s) => Number(s.meta.plies ?? Infinity))),
  maxMoves: MAX_MOVES,
  games: sources.reduce((n, s) => n + Number(s.meta.games ?? 0), 0),
  builtAt: new Date().toISOString(),
};
const setMeta = out.prepare('INSERT INTO meta (name, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(meta)) setMeta.run(k, JSON.stringify(v));
out.exec('COMMIT');
out.close();

console.log(
  'RESULT ' +
    JSON.stringify({ ...meta, files: sources.length, positions: written, inSeveralMonths: inSeveral, movesDropped, fileBytes: statSync(opts.out).size }),
);
