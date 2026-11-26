/**
 * A curve going up: a cumulative count per day (e.g. the moves learnt), as a 2px line over a light
 * area, scaled from 0. Hover or touch shows the day and its value (a crosshair and a tooltip);
 * a hidden table gives the figures to screen readers. One series: no legend, the label names it.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { fmt, locale } from '../i18n';

const W = 320;
const H = 96;
const PAD = { top: 8, right: 4, bottom: 4, left: 4 };

export function ProgressChart({ points, label }: { points: { day: number; value: number }[]; label: string }) {
  const box = useRef<SVGSVGElement>(null);
  const [at, setAt] = useState<number | null>(null);
  if (points.length < 2) return null;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H - PAD.bottom} L${x(0).toFixed(1)} ${H - PAD.bottom} Z`;
  const day = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const i = Math.round(((e.clientX - b.left) / b.width) * (points.length - 1));
    setAt(Math.max(0, Math.min(points.length - 1, i)));
  };
  const shown = at !== null ? points[at]! : null;
  const last = points.length - 1;
  return (
    <figure className="progress-chart">
      <div className="progress-plot">
      <svg
        ref={box}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} : ${fmt(points[0]!.value)} → ${fmt(points[last]!.value)}`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setAt(null)}
      >
        <path className="progress-area" d={area} />
        <path className="progress-line" d={line} vectorEffect="non-scaling-stroke" />
        {shown && <line className="progress-cross" x1={x(at!)} x2={x(at!)} y1={PAD.top} y2={H - PAD.bottom} vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* The markers outside the stretched SVG, so they stay round. */}
      <span className="progress-dot end" style={{ left: `${(x(last) / W) * 100}%`, top: `${(y(points[last]!.value) / H) * 100}%` }} />
      {shown && <span className="progress-dot" style={{ left: `${(x(at!) / W) * 100}%`, top: `${(y(shown.value) / H) * 100}%` }} />}
      </div>
      {/* The dates of the ends; the day under the pointer and its value between them. */}
      <figcaption className="progress-axis muted small-text">
        <span>{day(points[0]!.day)}</span>
        {shown && (
          <span className="progress-tip">
            <strong>{fmt(shown.value)}</strong> · {day(shown.day)}
          </span>
        )}
        <span>{day(points[last]!.day)}</span>
      </figcaption>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <th scope="row">{day(p.day)}</th>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
