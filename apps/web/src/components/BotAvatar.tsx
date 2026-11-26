/**
 * The faces of the fictional opponents (opponent.ts): flat drawings made of a few shapes, one
 * look per player (background, skin, hair, accessories), drawn in SVG at any size.
 */
import type { ReactNode } from 'react';

type Hair = 'cap' | 'pigtails' | 'messy' | 'bob' | 'beret' | 'long' | 'short' | 'bun' | 'bald';
type Extra = 'freckles' | 'glasses' | 'mustache' | 'beard' | 'earrings' | 'bowtie' | 'headband' | 'hood';

interface Look {
  bg: string;
  skin: string;
  hair: Hair;
  hairColor: string;
  shirt: string;
  extras: Extra[];
}

const LOOKS: Record<string, Look> = {
  Basile: { bg: '#4f9d69', skin: '#f2c9a0', hair: 'cap', hairColor: '#8a5a2b', shirt: '#e8b04a', extras: ['freckles'] },
  Lucie: { bg: '#d9739b', skin: '#f6d2b4', hair: 'pigtails', hairColor: '#e0a33a', shirt: '#6cb6e8', extras: [] },
  Hugo: { bg: '#4a7fc1', skin: '#d9a27a', hair: 'messy', hairColor: '#2e2420', shirt: '#7a8a99', extras: ['hood'] },
  Camille: { bg: '#8a68c9', skin: '#f0c7a6', hair: 'bob', hairColor: '#5a3424', shirt: '#2f3b52', extras: ['glasses'] },
  Victor: { bg: '#e07b39', skin: '#e9b48e', hair: 'beret', hairColor: '#3b2a20', shirt: '#f2efe6', extras: ['mustache'] },
  Inès: { bg: '#2e9c9c', skin: '#b97d57', hair: 'long', hairColor: '#1f1714', shirt: '#f1d45c', extras: ['headband', 'earrings'] },
  Maxime: { bg: '#c94f4f', skin: '#f1c6a3', hair: 'short', hairColor: '#a0522d', shirt: '#2b2b33', extras: ['beard', 'glasses'] },
  Sofia: { bg: '#4b4fa8', skin: '#e8b996', hair: 'bun', hairColor: '#2a1b16', shirt: '#c9364f', extras: ['earrings'] },
  Ivan: { bg: '#c9a227', skin: '#efc39f', hair: 'bald', hairColor: '#d8d8d8', shirt: '#1f2a3a', extras: ['beard', 'bowtie'] },
};

/** Hair drawn behind the head (long hair, pigtails, bob, bun). */
function hairBack(h: Hair, c: string): ReactNode {
  switch (h) {
    case 'pigtails':
      return (
        <>
          <circle cx="16" cy="33" r="5.5" fill={c} />
          <circle cx="48" cy="33" r="5.5" fill={c} />
        </>
      );
    case 'bob':
      return <path d="M17 30 C17 12 47 12 47 30 L47 41 C47 43 41 43 41 41 L41 31 L23 31 L23 41 C23 43 17 43 17 41 Z" fill={c} />;
    case 'long':
      return <path d="M17 29 C17 11 47 11 47 29 L49 52 L15 52 Z" fill={c} />;
    case 'bun':
      return <circle cx="32" cy="13.5" r="5.5" fill={c} />;
    default:
      return null;
  }
}

/** Hair (or hat) drawn over the head. */
function hairFront(h: Hair, c: string): ReactNode {
  switch (h) {
    case 'cap':
      return (
        <>
          <path d="M18.5 27 C18.5 14 45.5 14 45.5 27 Z" fill="#d9534f" />
          <path d="M40 23.4 h11 a2.2 2.2 0 0 1 0 4.4 h-11 z" fill="#b83f3b" />
          <path d="M19 27.5 L21 31 M45 27.5 L43 31" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        </>
      );
    case 'messy':
      return <path d="M19 28 L19.5 18 L24.5 21 L27 14.5 L31.5 19.5 L35.5 14 L38.5 20.5 L44 17 L45 28 C40 22 24 22 19 28 Z" fill={c} />;
    case 'beret':
      return (
        <>
          <path d="M19 27 C20 20 26 19 32 21 C38 19 44 20 45 27 C40 23.5 24 23.5 19 27 Z" fill={c} />
          <ellipse cx="30" cy="17.5" rx="14.5" ry="5" fill="#2f2f3a" transform="rotate(-8 30 17.5)" />
          <rect x="29" y="10" width="2.4" height="4" rx="1.2" fill="#2f2f3a" />
        </>
      );
    case 'bald':
      return (
        <>
          <path d="M18.5 30 C18 25 19 22 21 21 C20.5 25 21 28 21.5 31 Z" fill={c} />
          <path d="M45.5 30 C46 25 45 22 43 21 C43.5 25 43 28 42.5 31 Z" fill={c} />
        </>
      );
    case 'short':
      return <path d="M19 28 C18.5 15 45.5 15 45 28 C42 21.5 31 20.5 19 28 Z" fill={c} />;
    default:
      // A fringe: pigtails, bob, long, bun.
      return <path d="M19 29 C19 14 45 14 45 29 C41 22 33 21 27 23 C24 24 21 26 19 29 Z" fill={c} />;
  }
}

export function BotAvatar({ name, size = 46 }: { name: string; size?: number }) {
  const look = LOOKS[name] ?? LOOKS.Camille!;
  const { bg, skin, hair, hairColor: hc, shirt, extras } = look;
  const has = (e: Extra) => extras.includes(e);
  return (
    <svg className="bot-avatar" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={name}>
      <defs>
        <clipPath id={`bot-clip-${name}`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#bot-clip-${name})`}>
        <rect width="64" height="64" fill={bg} />
        <circle cx="32" cy="32" r="30" fill="#fff" opacity="0.08" />
        {hairBack(hair, hc)}
        {/* Shoulders and neck. */}
        <path d="M9 64 C9 51 19 46.5 32 46.5 C45 46.5 55 51 55 64 Z" fill={shirt} />
        {has('hood') && <path d="M14 58 C12 46 20 40 32 40 C44 40 52 46 50 58 C46 50 40 47 32 47 C24 47 18 50 14 58 Z" fill={shirt} opacity="0.85" />}
        <rect x="28" y="38" width="8" height="10" rx="3" fill={skin} />
        <path d="M28 46.5 L32 50 L36 46.5" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="1.2" />
        {/* Head and ears. */}
        <circle cx="18.6" cy="31" r="2.6" fill={skin} />
        <circle cx="45.4" cy="31" r="2.6" fill={skin} />
        <ellipse cx="32" cy="29.5" rx="13.2" ry="14" fill={skin} />
        {has('beard') && <path d="M19.5 31 C20 41 25 45 32 45 C39 45 44 41 44.5 31 C42 37 38 38.5 32 38.5 C26 38.5 22 37 19.5 31 Z" fill={hc} />}
        {/* Face. */}
        <circle cx="27" cy="30" r="1.7" fill="#2a1d18" />
        <circle cx="37" cy="30" r="1.7" fill="#2a1d18" />
        <path d="M24.8 26.4 Q27 25.2 29.2 26.2 M34.8 26.2 Q37 25.2 39.2 26.4" stroke="#2a1d18" strokeOpacity="0.55" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <circle cx="24.3" cy="34" r="1.8" fill="#e8746a" opacity="0.28" />
        <circle cx="39.7" cy="34" r="1.8" fill="#e8746a" opacity="0.28" />
        {has('mustache') ? (
          <path d="M27 36.2 C29 34.6 31 35.2 32 36 C33 35.2 35 34.6 37 36.2 C35 37.4 33 37 32 36.6 C31 37 29 37.4 27 36.2 Z" fill={hc} />
        ) : (
          <path d="M28.5 36 Q32 38.6 35.5 36" stroke="#7a3b2e" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        )}
        {has('freckles') && (
          <g fill="#b9734a" opacity="0.6">
            <circle cx="24.5" cy="32.6" r="0.6" />
            <circle cx="26.3" cy="33.6" r="0.6" />
            <circle cx="37.7" cy="33.6" r="0.6" />
            <circle cx="39.5" cy="32.6" r="0.6" />
          </g>
        )}
        {hairFront(hair, hc)}
        {has('headband') && <path d="M19.3 25 C24 19.5 40 19.5 44.7 25" stroke="#f1d45c" strokeWidth="2.4" fill="none" strokeLinecap="round" />}
        {has('glasses') && (
          <g fill="none" stroke="#1d1d22" strokeWidth="1.3">
            <circle cx="27" cy="30" r="3.9" fill="#fff" fillOpacity="0.15" />
            <circle cx="37" cy="30" r="3.9" fill="#fff" fillOpacity="0.15" />
            <path d="M30.9 29.6 Q32 28.8 33.1 29.6 M23.1 29.6 L19.5 28.6 M40.9 29.6 L44.5 28.6" />
          </g>
        )}
        {has('earrings') && (
          <>
            <circle cx="18.4" cy="34.6" r="1.3" fill="#f5d06b" />
            <circle cx="45.6" cy="34.6" r="1.3" fill="#f5d06b" />
          </>
        )}
        {has('bowtie') && <path d="M26 51 L32 53.5 L38 51 L38 57 L32 54.5 L26 57 Z" fill="#c0392b" />}
      </g>
    </svg>
  );
}
