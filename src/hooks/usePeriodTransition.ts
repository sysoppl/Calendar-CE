// The calendar's period changes with a short movement instead of a cut: the
// new days slide in from the side they come from (from the right for later,
// from the left for earlier), and a new view grows in. Only transform and
// opacity are animated, through the Web Animations API, so the compositor
// moves the pixels even while the main thread is still drawing. A change that
// comes before the last one ended cancels it and starts from where things
// are, so pressing "next" quickly never queues up. With reduced motion asked
// for (Android's "Remove animations" says so too) the new content only fades
// from 60 % to full in 120 ms. A swipe that brought the next period into
// view beside the current one (hooks/useSwipePager.ts) leaves nothing to
// animate: the new period is drawn exactly where it already is.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useUi } from '@/store/ui';

/** The id of every animation of a calendar period (here and in useSwipePager). */
export const PERIOD_ANIMATION = 'period';

export const SLIDE_PX = 24;
export const SLIDE_MS = 220;
export const VIEW_MS = 180;
export const FADE_MS = 180;
export const REDUCED_MS = 120;
/** Starts fast and settles gently. */
export const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)';

/** How the new content arrives: sliding (the grids) or fading (the lists). */
export type TransitionKind = 'slide' | 'fade';

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Ends the period animations on `el` and drops what a swipe left on it, so it rests where it belongs. */
export function settle(el: HTMLElement): void {
  for (const a of el.getAnimations?.() ?? []) if (a.id === PERIOD_ANIMATION) a.cancel();
  el.style.transform = '';
  el.style.opacity = '';
}

/** Runs one period animation on `el` (where the browser has the API). */
export function animatePeriod(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | undefined {
  if (typeof el.animate !== 'function') return undefined;
  return el.animate(keyframes, { ...options, id: PERIOD_ANIMATION });
}

/** The view switch that was last animated; a view that appears with another number came from a switch. */
let animatedViewSeq = 0;
/** How far the next slide starts; a swipe sets it a little further (it follows the finger's movement). */
let nextSlide = SLIDE_PX;

/** Until when the next period is already in place (ms since the epoch); 0 when it is not. */
let inPlaceUntil = 0;
/** How long `arriveInPlace` waits for the period that it announces. */
export const IN_PLACE_MS = 1000;

/** Lets the next period slide in from `px` instead of the usual distance (once). */
export function slideNextFrom(px: number): void {
  nextSlide = px;
}

/**
 * Tells the next period change, should it come within a second, that the new
 * period is already on screen where it belongs (a swipe slid it there): it
 * then only rests in place, without a slide or a fade.
 */
export function arriveInPlace(): void {
  inPlaceUntil = Date.now() + IN_PLACE_MS;
}

function play(els: HTMLElement[], mode: 'period' | 'view', kind: TransitionKind, dir: number): void {
  const reduced = prefersReducedMotion();
  const from = nextSlide;
  nextSlide = SLIDE_PX;
  const inPlace = mode === 'period' && Date.now() < inPlaceUntil;
  inPlaceUntil = 0;
  for (const el of els) {
    settle(el);
    // A swipe has already slid it where it belongs.
    if (inPlace) continue;
    if (reduced) {
      animatePeriod(el, [{ opacity: 0.6 }, { opacity: 1 }], { duration: REDUCED_MS, easing: 'linear' });
    } else if (mode === 'view') {
      animatePeriod(el, [{ transform: 'scale(0.985)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: VIEW_MS, easing: EASE_OUT });
    } else if (kind === 'fade') {
      animatePeriod(el, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: EASE_OUT });
    } else {
      animatePeriod(el, [{ transform: `translateX(${dir * from}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: SLIDE_MS, easing: EASE_OUT });
    }
  }
}

/**
 * Animates `refs` when `periodKey` changes (the first day shown, say), in the
 * direction the store's `navDir` says; and once when the view itself has just
 * appeared through a switch of view. A change without a direction (a setting
 * that moved the first day) is not animated.
 */
export function usePeriodTransition(refs: RefObject<HTMLElement | null>[], periodKey: string | number, kind: TransitionKind = 'slide'): void {
  const shown = useRef<string | number | null>(null);
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = periodKey;
    const els = refs.map((r) => r.current).filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const { navDir, viewSeq } = useUi.getState();
    if (previous === null) {
      // Just appeared: animated only when a switch of view brought it (the count only grows).
      if (viewSeq <= animatedViewSeq) return;
      animatedViewSeq = viewSeq;
      play(els, 'view', kind, 0);
      return;
    }
    if (previous === periodKey || navDir === 0) return;
    play(els, 'period', kind, navDir);
    // The refs are the same elements for the life of the view.
  }, [periodKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
