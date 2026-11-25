import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { gapCutoffFor, LINE_DEPTHS } from '@e4e5/core';
import type { Me, TrainingSummary } from '../api';
import { RatingRange } from '../components/RatingRange';
import { depthPct, explorerParams, NO_LIMIT, SPEED_CHOICES, SPEED_NAMES, useSettings, type LearnOrder, type SpeedChoice } from '../settings';
import { fmt, lang, setLang, t, type Lang } from '../i18n';
import { PageHeader, plural, Tabs } from '../ui';
import { useTrainingSummary } from '../useTrainingSummary';

const PERIODS = [
  { days: 30, label: t('30 derniers jours', 'Last 30 days') },
  { days: 90, label: t('3 derniers mois', 'Last 3 months') },
  { days: 365, label: t('12 derniers mois', 'Last 12 months') },
  { days: 0, label: t('Toutes les parties', 'All games') },
];
const GAME_SPEEDS = ['bullet', 'blitz', 'rapid', 'classical', 'daily'];

/** Paramètres: the app's settings (games analysed, statistics, training, board). Accounts: Account page. */
export function Settings({ me }: { me: Me }) {
  const settings = useSettings();
  const ex = explorerParams(me, settings.speed, settings.range);
  useScrollToHash();

  const toggleSpeed = (s: string) =>
    settings.setGamesSpeeds(settings.gamesSpeeds.includes(s) ? settings.gamesSpeeds.filter((x) => x !== s) : [...settings.gamesSpeeds, s]);

  return (
    <div className="narrow-page stack">
      <PageHeader
        title={t('Paramètres', 'Settings')}
        subtitle={t(
          <>Comptes Lichess et Chess.com, mot de passe : <Link to="/account">Mon compte</Link></>,
          <>Lichess and Chess.com accounts, password: <Link to="/account">My account</Link></>,
        )}
      />

      <section className="card" id="language">
        <div className="setting">
          <div className="what"><strong>Langue / Language</strong></div>
          <Tabs<Lang>
            tabs={[
              { id: 'fr', label: 'Français' },
              { id: 'en', label: 'English' },
            ]}
            value={lang}
            onChange={setLang}
          />
        </div>
      </section>

      <section className="card" id="games">
        <h3>{t('Parties analysées', 'Games analysed')}</h3>
        <div className="setting">
          <div className="what">
            <strong>{t('Période', 'Period')}</strong>
            <div className="hint">{t('Les parties prises en compte dans Mes parties et les Lacunes.', 'The games taken into account in My games and Gaps.')}</div>
          </div>
          <select value={settings.gamesDays} onChange={(e) => settings.setGamesDays(Number(e.target.value))}>
            {PERIODS.map((p) => (
              <option key={p.days} value={p.days}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="setting">
          <div className="what"><strong>{t('Cadences', 'Speeds')}</strong></div>
          <div className="row">
            {GAME_SPEEDS.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" checked={settings.gamesSpeeds.includes(s)} onChange={() => toggleSpeed(s)} /> {SPEED_NAMES[s]}
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="card" id="statistics">
        <h3>{t('Statistiques d’ouvertures', 'Opening statistics')}</h3>
        <p className="muted small-text">
          {t(
            'Les coups joués par les joueurs Lichess de votre niveau : flèches, tableaux, coups manquants, adversaire de l’entraînement.',
            'The moves played by Lichess players of your level: arrows, tables, missing moves, training opponent.',
          )}
        </p>
        <div className="setting">
          <div className="what"><strong>{t('Cadence', 'Speed')}</strong></div>
          <select value={settings.speed} onChange={(e) => settings.setSpeed(e.target.value as SpeedChoice)}>
            {(Object.keys(SPEED_CHOICES) as SpeedChoice[]).map((s) => (
              <option key={s} value={s}>{SPEED_CHOICES[s]}</option>
            ))}
          </select>
        </div>
        <div className="setting">
          <div className="what">
            <strong>{t('Niveau des joueurs', 'Players’ level')}</strong>
            <div className="hint">
              {ex.source
                ? t(`Automatique : autour de votre classement ${ex.source} (${ex.rating}).`, `Automatic: around your ${ex.source} rating (${ex.rating}).`)
                : t('Automatique : autour de 1500 (aucun classement connu).', 'Automatic: around 1500 (no known rating).')}{' '}
              {t(
                'Les classements Chess.com sont en général plus bas que ceux de Lichess à force égale : ajustez la tranche à vos adversaires.',
                'Chess.com ratings are usually lower than Lichess ones for the same strength: adjust the range to your opponents.',
              )}
            </div>
          </div>
          <div style={{ minWidth: 240, flex: 1 }}>
            <RatingRange current={ex.ratings} />
          </div>
        </div>
      </section>

      <section className="card" id="board">
        <h3>{t('Échiquier', 'Board')}</h3>
        <div className="setting">
          <div className="what">
            <strong>{t('Sons des coups', 'Move sounds')}</strong>
            <div className="hint">{t('Un son à chaque coup joué et à chaque prise (sons de Lichess).', 'A sound for every move played and every capture (Lichess sounds).')}</div>
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.sound} onChange={(e) => settings.setSound(e.target.checked)} /> {t('Activés', 'On')}
          </label>
        </div>
        <div className="setting">
          <div className="what">
            <strong>{t('Vibration sur erreur', 'Vibrate on mistakes')}</strong>
            <div className="hint">{t('Sur téléphone, le coup qui n’est pas dans votre répertoire fait vibrer.', 'On phones, a move that is not in your repertoire makes the phone vibrate.')}</div>
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.haptics} onChange={(e) => settings.setHaptics(e.target.checked)} /> {t('Activée', 'On')}
          </label>
        </div>
      </section>

      <section className="card" id="training">
        <h3>{t('Entraînement et préparation', 'Training and preparation')}</h3>
        <div className="setting">
          <div className="what">
            <strong>{t('Nouvelles lignes par jour', 'New lines per day')}</strong>
            <div className="hint">
              {t(
                'Pour tous les répertoires actifs ensemble. Chaque ligne est apprise en entier ; les lignes à revoir ne sont jamais limitées.',
                'For all the active repertoires together. Each line is learnt in full; lines due for review are never limited.',
              )}
            </div>
          </div>
          <select value={settings.newPerDay} onChange={(e) => settings.setNewPerDay(Number(e.target.value))}>
            {[1, 3, 5, 10, 20, NO_LIMIT].map((n) => (
              <option key={n} value={n}>{n === NO_LIMIT ? t('Sans limite', 'No limit') : n}</option>
            ))}
          </select>
        </div>
        <div className="setting">
          <div className="what">
            <strong>{t('Ordre des nouvelles lignes', 'Order of new lines')}</strong>
            <div className="hint">
              {settings.learnOrder === 'frequency'
                ? t('D’abord ce que vos adversaires jouent le plus à votre niveau (statistiques Lichess).', 'First what your opponents play most at your level (Lichess statistics).')
                : t(
                    'L’ordre du répertoire : ligne principale d’abord, puis les variantes (utile pour un cours pensé dans un ordre précis).',
                    'The repertoire’s order: main line first, then the sidelines (useful for a course designed in a specific order).',
                  )}
            </div>
          </div>
          <select value={settings.learnOrder} onChange={(e) => settings.setLearnOrder(e.target.value as LearnOrder)}>
            <option value="frequency">{t('Les plus jouées à mon niveau', 'Most played at my level')}</option>
            <option value="repertoire">{t('Ordre du répertoire', 'Repertoire order')}</option>
          </select>
        </div>
        <div className="setting">
          <div className="what">
            <strong>{t('Plusieurs coups dans une position', 'Several moves in a position')}</strong>
            <div className="hint">
              {settings.mainMoveOnly
                ? t(
                    'Seul le coup principal (le premier) est révisé ; les autres coups et les lignes qui les suivent ne sont pas entraînés. Jouer l’un d’eux reste accepté.',
                    'Only the main move (the first) is reviewed; the other moves and the lines after them are not trained. Playing one of them is still accepted.',
                  )
                : t(
                    'Quand votre répertoire prévoit plusieurs coups pour vous dans une même position, chacun est révisé, avec les lignes qui le suivent.',
                    'When your repertoire has several moves for you in the same position, each one is reviewed, with the lines after it.',
                  )}
            </div>
          </div>
          <select value={settings.mainMoveOnly ? 'main' : 'all'} onChange={(e) => settings.setMainMoveOnly(e.target.value === 'main')}>
            <option value="all">{t('Réviser tous mes coups', 'Review all my moves')}</option>
            <option value="main">{t('Seulement le coup principal', 'Only the main move')}</option>
          </select>
        </div>
        <LineDepthSetting me={me} />
        <div className="setting">
          <div className="what">
            <strong>{t('Temps pour répondre', 'Time to answer')}</strong>
            <div className="hint">
              {t(
                'En mode « Se tester », pour chaque coup à jouer (pas en révision). Temps écoulé : compté comme une erreur, la réponse est montrée.',
                'In “Test yourself” mode, for each move to play (not in review). Time up: counted as a mistake, the answer is shown.',
              )}
            </div>
          </div>
          <select value={settings.answerSeconds} onChange={(e) => settings.setAnswerSeconds(Number(e.target.value))}>
            {[5, 10, 15, 20, 30, 0].map((n) => (
              <option key={n} value={n}>{n === 0 ? t('Sans limite', 'No limit') : `${n} s`}</option>
            ))}
          </select>
        </div>
      </section>

      <LocalModeSetting ratings={ex.ratings} />

      {/* Absolute address: in the mobile app, it opens in the system browser. */}
      <p className="muted small-text">
        <a href="https://gab23r.github.io/e4e5/privacy.html" target="_blank" rel="noreferrer">
          {t('Politique de confidentialité', 'Privacy policy')}
        </a>
      </p>
    </div>
  );
}

/** The statistics files, downloaded on this device. */
function LocalModeSetting({ ratings }: { ratings: number[] }) {
  return (
    <section className="card" id="local">
      <h3>{t('Statistiques', 'Statistics')}</h3>
      <LocalStatsSetting ratings={ratings} />
    </section>
  );
}

const bucketLabel = (b: number, next?: number) =>
  b === 0 ? t('Moins de 1000', 'Under 1000') : next ? `${b}–${next - 1}` : t(`${b} et plus`, `${b} and up`);
const mo = (bytes: number) => `${fmt(bytes / 1e6, { maximumFractionDigits: bytes < 1e7 ? 1 : 0, minimumFractionDigits: bytes < 1e7 ? 1 : 0 })} ${t('Mo', 'MB')}`;
const pct = (n: number) => t(`${n} %`, `${n}%`);

/**
 * Statistics on the device: the files per rating bucket of the Lichess game database,
 * downloaded here (local/stats.ts). The buckets of the
 * settings are marked: with all of them here, the explorer, the search at my level and the
 * missing moves are computed on the device.
 */
function LocalStatsSetting({ ratings }: { ratings: number[] }) {
  type Stats = typeof import('../local/stats');
  const [index, setIndex] = useState<Awaited<ReturnType<Stats['statsIndex']>> | null>(null);
  const [files, setFiles] = useState<Awaited<ReturnType<Stats['localStatsFiles']>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<number, string>>({});
  const queryClient = useQueryClient();
  const lib = () => import('../local/stats');
  const refresh = async () => setFiles(await (await lib()).localStatsFiles());
  useEffect(() => {
    void lib().then(async (m) => {
      await m.statsIndex().then(setIndex, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
      await refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    });
  }, []);
  const here = new Set(files.map((f) => f.bucket));
  const download = async (file: NonNullable<typeof index>['files'][number]) => {
    setBusy((b) => ({ ...b, [file.bucket]: pct(0) }));
    try {
      await (await lib()).downloadStats(file, (p) =>
        setBusy((b) => ({ ...b, [file.bucket]: p.total ? pct(Math.round((100 * p.loaded) / p.total)) : mo(p.loaded) })),
      );
      setError(null);
    } catch (e) {
      setError(`${bucketLabel(file.bucket)}${t(' : ', ': ')}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(({ [file.bucket]: _, ...rest }) => rest);
      await refresh();
      await queryClient.invalidateQueries();
    }
  };
  const remove = async (bucket: number) => {
    await (await lib()).deleteStats(bucket);
    await refresh();
    await queryClient.invalidateQueries();
  };
  const offered = index?.files ?? [];
  const missing = offered.filter((f) => ratings.includes(f.bucket) && !here.has(f.bucket));
  const downloadMine = async () => {
    for (const f of missing) await download(f);
  };
  return (
    <div className="setting setting-block">
      <div className="what">
        <strong>{t('Statistiques sur cet appareil', 'Statistics on this device')}</strong>
        <div className="hint">
          {t('Les parties de la base Lichess', 'The games of the Lichess database')}
          {index ? ` (${index.period.since === index.period.until ? index.period.since : `${index.period.since}${t(' à ', ' to ')}${index.period.until}`})` : ''}
          {t(
            ', une tranche Elo par fichier. Avec toutes les tranches de vos réglages (marquées ●), l’explorateur, la recherche à votre niveau et les coups manquants sont calculés sur l’appareil ; sans elles, pas de statistiques.',
            ', one Elo range per file. With all the ranges of your settings (marked ●), the explorer, the search at your level and the missing moves are computed on the device; without them, no statistics.',
          )}
        </div>
        {error && <div className="hint error">{error}</div>}
      </div>
      {offered.length > 0 && (
        <table className="stats-files">
          <tbody>
            {offered.map((f, i) => (
              <tr key={f.bucket}>
                <td>
                  {ratings.includes(f.bucket) ? '● ' : ''}
                  {bucketLabel(f.bucket, offered[i + 1]?.bucket)}
                </td>
                <td className="muted">{plural(f.positions, 'position', 'positions')}</td>
                <td className="muted">{mo(f.bytes)}</td>
                <td>
                  {busy[f.bucket] ? (
                    <span className="muted">{busy[f.bucket]}</span>
                  ) : here.has(f.bucket) ? (
                    <button className="link" onClick={() => remove(f.bucket)}>
                      {t('Supprimer', 'Delete')}
                    </button>
                  ) : (
                    <button onClick={() => download(f)}>{t('Télécharger', 'Download')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {missing.length > 0 && !Object.keys(busy).length && (
        <button onClick={downloadMine}>
          {t('Télécharger les tranches de mes réglages', 'Download the ranges of my settings')} ({mo(missing.reduce((n, f) => n + f.bytes, 0))})
        </button>
      )}
    </div>
  );
}

/**
 * Depth of the lines: positions trained (and holes listed) from a share of the games at my level.
 * Each choice shows the positions it trains in the active repertoires, more telling than the share.
 */
function LineDepthSetting({ me }: { me: Me }) {
  const { lineDepth, setLineDepth } = useSettings();
  const summary = useTrainingSummary(me);
  const active = (summary.data ?? []).filter((s) => s.active);
  const sum = (f: (s: TrainingSummary) => number | undefined) => (summary.data ? active.reduce((n, s) => n + (f(s) ?? 0), 0) : undefined);
  const withStats = active.every((s) => s.byDepth);
  const choices = [
    ...LINE_DEPTHS.map((d) => ({ depth: d as number, positions: withStats ? sum((s) => s.byDepth?.[String(d)]) : undefined, label: t(`au moins ${depthPct(d)} des parties`, `at least ${depthPct(d)} of games`) })),
    { depth: 0, positions: sum((s) => s.positions), label: t('lignes entières', 'whole lines') },
  ];
  return (
    <div className="setting setting-block">
      <div className="what">
        <strong>{t('Profondeur des lignes', 'Depth of lines')}</strong>
        <div className="hint">
          {t(
            'Une position est entraînée si on la rencontre dans au moins cette part des parties à votre niveau (statistiques Lichess). Les coups manquants sont signalés à partir du même seuil',
            'A position is trained if it occurs in at least this share of the games at your level (Lichess statistics). Missing moves are flagged from the same threshold',
          )}
          {lineDepth === 0 ? t(` (${depthPct(gapCutoffFor(0))} avec les lignes entières)`, ` (${depthPct(gapCutoffFor(0))} with whole lines)`) : ''}.{' '}
          {t('Positions de vos répertoires en entraînement.', 'Positions of your repertoires in training.')}
        </div>
      </div>
      <div className="depth-choices" role="radiogroup" aria-label={t('Profondeur des lignes', 'Depth of lines')}>
        {choices.map((c) => (
          <label key={c.depth} className={`depth-choice ${lineDepth === c.depth ? 'on' : ''}`}>
            <input type="radio" name="line-depth" checked={lineDepth === c.depth} onChange={() => setLineDepth(c.depth)} />
            <strong>{c.positions === undefined ? '…' : plural(c.positions, 'position', 'positions')}</strong>
            <span className="muted">{c.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** /settings#statistics, /account#accounts: open on that section. */
export function useScrollToHash() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);
}
