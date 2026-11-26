/**
 * The rows (or chips) of a list slide to their new place when their order changes (a move paused goes down
 * into the paused zone, a move made main goes up): FLIP animation. Rows carry data-flip (a key
 * stable for the row); their position is measured relative to the list after each render, so a
 * scroll of the page does not move anything.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';

const MS = 320;

export function useFlip(list: RefObject<HTMLElement | null>) {
  const before = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const origin = el.getBoundingClientRect();
    const now = new Map<string, { x: number; y: number }>();
    for (const row of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const key = row.dataset.flip!;
      const box = row.getBoundingClientRect();
      // Where the layout puts it, without the slide still running (renders come during it, e.g.
      // while another move is dragged): measured with it, the slides would pile up.
      const slide = new DOMMatrixReadOnly(getComputedStyle(row).transform === 'none' ? undefined : getComputedStyle(row).transform);
      const at = { x: box.left - slide.m41 - origin.left, y: box.top - slide.m42 - origin.top };
      now.set(key, at);
      const was = before.current.get(key);
      // Not a row being dragged (it follows the pointer, then lands where dropped).
      const moved = was && (Math.abs(was.x - at.x) > 1 || Math.abs(was.y - at.y) > 1);
      if (was && moved && !reduced && !row.classList.contains('dragging')) {
        for (const running of row.getAnimations()) running.cancel();
        row.animate([{ transform: `translate(${was.x - at.x}px, ${was.y - at.y}px)` }, { transform: 'none' }], { duration: MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    }
    before.current = now;
  });
}
