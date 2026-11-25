/**
 * Move annotations (NAGs of the PGN: !, ?, !!, ??, !?, ?!): the move is coloured and followed by
 * its symbol, with the usual colours (as on Lichess). Other NAGs (positions, ±…) are not shown.
 */
import { t } from '../i18n';

/** `color`: the same as the .nag-<kind> classes (styles.css), for the badge on the board. */
export const MOVE_NAGS: Record<number, { symbol: string; kind: string; label: string; color: string }> = {
  1: { symbol: '!', kind: 'good', label: t('Bon coup', 'Good move'), color: '#22ac38' },
  2: { symbol: '?', kind: 'mistake', label: t('Erreur', 'Mistake'), color: '#e69f00' },
  3: { symbol: '!!', kind: 'brilliant', label: t('Coup brillant', 'Brilliant move'), color: '#26c2a3' },
  4: { symbol: '??', kind: 'blunder', label: t('Gaffe', 'Blunder'), color: '#df5353' },
  5: { symbol: '!?', kind: 'interesting', label: t('Coup intéressant', 'Interesting move'), color: '#ea45d8' },
  6: { symbol: '?!', kind: 'dubious', label: t('Coup douteux', 'Dubious move'), color: '#56b4e9' },
};

/** The move annotation among the NAGs of a move (the first one, if several). */
export function moveNag(nags: readonly number[] | null | undefined) {
  const n = nags?.find((x) => x in MOVE_NAGS);
  return n === undefined ? undefined : MOVE_NAGS[n];
}

/** A move in SAN, coloured with its annotation and followed by its symbol. */
export function San({ san, nags }: { san: string; nags?: readonly number[] | null }) {
  const nag = moveNag(nags);
  if (!nag) return <>{san}</>;
  return (
    <span className={`nag nag-${nag.kind}`} title={nag.label}>
      {san}
      {nag.symbol}
    </span>
  );
}
