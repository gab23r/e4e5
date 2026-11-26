/**
 * The faces of the fictional opponents (opponent.ts): one illustrated portrait per player
 * (public/bots, 256 px WebP on white), shown in a circle.
 */

/** The portrait of each player, and its colour (of its clothes: the background of its card). */
const FACES: Record<string, { face: string; color: string }> = {
  Basile: { face: 'debutant', color: '#d9a35a' },
  Hugo: { face: 'gambit', color: '#4f9a8c' },
  Maxime: { face: 'club', color: '#4a6d9c' },
  Victor: { face: 'attaquant', color: '#e07b4f' },
  Camille: { face: 'experte', color: '#a3445c' },
  Simone: { face: 'positionnelle', color: '#8aa07a' },
  Ivan: { face: 'maitre', color: '#b07a3a' },
  Turing: { face: 'machine', color: '#7f93a6' },
};

/** The colour of a player. */
export const botColor = (name: string) => (FACES[name] ?? FACES.Basile!).color;

export function BotAvatar({ name, size = 46 }: { name: string; size?: number }) {
  const { face } = FACES[name] ?? FACES.Basile!;
  return <img className="bot-avatar" src={`${import.meta.env.BASE_URL}bots/${face}.webp`} width={size} height={size} alt={name} draggable={false} />;
}
