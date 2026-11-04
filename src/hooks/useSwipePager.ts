// A finger swiped sideways over the calendar pages to the previous or next
// period, following the finger while it moves. The order in which a touch
// is read (shared with the time grid's long press, components/views/
// TimeGridView.tsx):
// 1. A finger held still (under 8 px) on an event for 450 ms picks the event
//    up; the grid claims the touch (claimSwipe) and this pager lets it go.
// 2. Otherwise, after 10 px, the direction is locked: mostly sideways
//    (|dx| > 1.2·|dy|) pages, anything else is left to the browser's own
//    vertical scrolling. The calendar's elements carry `touch-action: pan-y`,
//    so sideways moves reach the page while vertical ones scroll at once.
// While locked, the elements marked `data-pager` follow the finger (with
// resistance past 40 % of the width), and the view is asked (onPeek) to draw
// the periods before and after inside them, one width to the left and to the
// right, each marked `data-pager-peer` with its side: a carousel, so that the
// neighbouring month is there as the finger pulls it in rather than an empty
// space. The view draws them as a low-priority update, so the finger is
// followed even while they are being drawn. On release the period changes
// when the finger travelled over 22 % of the width or flicked faster than
// 0.35 px/ms:
// - with the neighbour drawn, the elements glide until it is exactly where the
//   current period was, and only then does the period change; the view draws
//   the new period there without an animation of its own (arriveInPlace);
// - without it (not drawn yet, or a view that has none), the old period slides
//   out on the compositor while the new one is drawn, and usePeriodTransition
//   slides the new one in.
// Otherwise the elements spring back, and the neighbours go once they are out
// of sight. A new touch during any of these animations takes over from where
// the elements are. With reduced motion nothing follows the finger and no
// neighbour is drawn: the period just changes on release, with the short fade.
import { useEffect, useRef, type RefObject } from 'react';
import { EASE_OUT, PERIOD_ANIMATION, animatePeriod, arriveInPlace, prefersReducedMotion, settle, slideNextFrom } from './usePeriodTransition';

/** Movement before the direction of a touch is decided. */
export const LOCK_PX = 10;
/** Sideways means this much more sideways than vertical. */
export const LOCK_RATIO = 1.2;
/** Share of the width a slow swipe has to travel to change the period. */
export const COMMIT_SHARE = 0.22;
/** A flick at least this fast (px/ms) changes the period whatever the distance. */
export const FLICK_SPEED = 0.35;
/** Past this share of the width the content follows the finger only partly. */
export const RUBBER_SHARE = 0.4;
export const RUBBER_FACTOR = 0.3;
/** The speed of a release is measured over its last this many ms. */
export const VELOCITY_WINDOW_MS = 80;
export const SPRING_MS = 180;
export const OUT_MS = 180;
/** How the old period leaves: speeding up, out of sight. */
export const EASE_IN = 'cubic-bezier(0.3, 0, 0.8, 0.15)';
/** How far the new period starts after a swipe. */
export const SWIPE_SLIDE_PX = 32;

/**
 * What a released swipe does: 1 for the next period (the finger went left),
 * -1 for the previous one, 0 to spring back. `dx` is the distance travelled
 * (px, positive to the right), `vx` the speed at release (px/ms).
 */
export function swipeDecision(dx: number, vx: number, width: number): -1 | 0 | 1 {
  const flick = Math.abs(vx) >= FLICK_SPEED;
  // A flick back towards the start cancels whatever the distance.
  if (flick && Math.sign(vx) !== Math.sign(dx) && dx !== 0) return 0;
  if (flick || Math.abs(dx) > COMMIT_SHARE * width) {
    const towards = dx !== 0 ? dx : vx;
    return towards < 0 ? 1 : towards > 0 ? -1 : 0;
  }
  return 0;
}

/** Whether a released swipe changes the period. */
export function shouldCommit(dx: number, vx: number, width: number): boolean {
  return swipeDecision(dx, vx, width) !== 0;
}

/** Where the content is drawn for a finger `dx` from where it started: one to one, then with resistance. */
export function rubberBand(dx: number, width: number): number {
  const free = RUBBER_SHARE * width;
  if (Math.abs(dx) <= free) return dx;
  return Math.sign(dx) * (free + (Math.abs(dx) - free) * RUBBER_FACTOR);
}

/** The speed of a moving point over its recent positions. */
export class VelocityTracker {
  private samples: { at: number; t: number }[] = [];

  add(at: number, t: number): void {
    this.samples.push({ at, t });
    while (this.samples.length > 2 && t - this.samples[0].t > VELOCITY_WINDOW_MS) this.samples.shift();
  }

  /** px/ms over the window; 0 without two samples apart in time. */
  velocity(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.t <= first.t) return 0;
    return (last.at - first.at) / (last.t - first.t);
  }
}

/** Touches taken by something else (an event being moved): the pager lets them go. */
const claimed = new Set<number>();

/** Takes the touch `pointerId` away from the pager for the rest of its life. */
export function claimSwipe(pointerId: number): void {
  claimed.add(pointerId);
}

/** Runs `fn` once the next frame has been painted. */
function afterFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fn, 0));
  else setTimeout(fn, 16);
}

/** Whether every element that follows the finger has the period on side `dir` drawn beside it. */
export function peersShown(targets: HTMLElement[], dir: -1 | 1): boolean {
  return targets.length > 0 && targets.every((el) => el.querySelector(`:scope > [data-pager-peer="${dir}"]`) !== null);
}

/** The horizontal offset an element is drawn at now (mid-animation, say). */
function currentOffset(el: HTMLElement): number {
  try {
    const transform = getComputedStyle(el).transform;
    if (!transform || transform === 'none') return 0;
    return new DOMMatrixReadOnly(transform).m41;
  } catch {
    return 0;
  }
}

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  /** Where the content was when the finger came down. */
  base: number;
  locked: boolean;
  width: number;
  targets: HTMLElement[];
  tracker: VelocityTracker;
  offset: number;
  frame: number | null;
}

export interface SwipePagerOptions {
  /** Off in the year view, which scrolls up and down only. */
  enabled: boolean;
  /** Changes the period: 1 next, -1 previous. */
  onStep: (dir: 1 | -1) => void;
  /** Asks for the periods beside the current one to be drawn (true) or no longer (false); see the top of this file. */
  onPeek?: (on: boolean) => void;
}

/** Pages the calendar inside `ref` by sideways swipes of a finger (see the top of this file). */
export function useSwipePager(ref: RefObject<HTMLElement | null>, { enabled, onStep, onPeek }: SwipePagerOptions): void {
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const peekRef = useRef(onPeek);
  peekRef.current = onPeek;

  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    let g: Gesture | null = null;

    /** Asks for the neighbours, or for them to go now or `after` ms from now (a later call replaces a waiting one). */
    let peekTimer: ReturnType<typeof setTimeout> | null = null;
    const peek = (on: boolean, after = 0) => {
      if (peekTimer !== null) clearTimeout(peekTimer);
      peekTimer = null;
      if (on || !after) {
        peekRef.current?.(on);
        return;
      }
      peekTimer = setTimeout(() => {
        peekTimer = null;
        peekRef.current?.(false);
      }, after);
    };

    const place = (gesture: Gesture, x: number) => {
      for (const el of gesture.targets) el.style.transform = x ? `translateX(${x}px)` : '';
    };

    const springBack = (gesture: Gesture) => {
      const from = gesture.offset;
      for (const el of gesture.targets) {
        el.style.transform = '';
        if (from) animatePeriod(el, [{ transform: `translateX(${from}px)` }, { transform: 'none' }], { duration: SPRING_MS, easing: EASE_OUT });
      }
      peek(false, SPRING_MS);
    };

    /** Ends tracking; `release` says how (spring back or nothing). */
    const end = (springs: boolean) => {
      const gesture = g;
      g = null;
      if (!gesture) return;
      if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
      if (springs) springBack(gesture);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary || claimed.has(e.pointerId)) return;
      const targets = [...root.querySelectorAll<HTMLElement>('[data-pager]')];
      if (!targets.length) return;
      // Caught mid-animation: carry on from where the content is.
      const base = targets.some((el) => el.getAnimations?.().some((a) => a.id === PERIOD_ANIMATION)) ? currentOffset(targets[0]) : 0;
      for (const el of targets) settle(el);
      // Neighbours that were about to go stay for the new touch.
      if (base) peek(true);
      const gesture: Gesture = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, base, locked: false, width: root.clientWidth || window.innerWidth, targets, tracker: new VelocityTracker(), offset: base, frame: null };
      if (base) place(gesture, base);
      g = gesture;
    };

    const onMove = (e: PointerEvent) => {
      const gesture = g;
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      if (claimed.has(e.pointerId)) return end(gesture.locked || gesture.base !== 0);
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (!gesture.locked) {
        if (Math.hypot(dx, dy) < LOCK_PX) return;
        if (Math.abs(dx) <= LOCK_RATIO * Math.abs(dy)) return end(gesture.base !== 0);
        gesture.locked = true;
        if (!prefersReducedMotion()) peek(true);
      }
      gesture.tracker.add(e.clientX, e.timeStamp);
      if (prefersReducedMotion()) return;
      gesture.offset = rubberBand(gesture.base + dx, gesture.width);
      if (typeof requestAnimationFrame !== 'function') place(gesture, gesture.offset);
      else if (gesture.frame === null) {
        gesture.frame = requestAnimationFrame(() => {
          gesture.frame = null;
          if (g === gesture) place(gesture, gesture.offset);
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      claimed.delete(e.pointerId);
      const gesture = g;
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      if (!gesture.locked) return end(gesture.base !== 0);
      g = null;
      if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
      const travelled = gesture.base + (e.clientX - gesture.x);
      const dir = swipeDecision(travelled, gesture.tracker.velocity(), gesture.width);
      if (!dir) return springBack(gesture);
      if (!prefersReducedMotion()) {
        // The old period leaves on the compositor, faster the further it already went. With the
        // period it goes to drawn beside it, the two glide to a stop instead: that one is what stays.
        const from = gesture.offset;
        const to = -dir * gesture.width;
        const carried = peersShown(gesture.targets, dir);
        const duration = Math.max(60, Math.min(OUT_MS, (Math.abs(to - from) / gesture.width) * 240));
        const outs = gesture.targets.map((el) => {
          el.style.transform = '';
          const out = animatePeriod(el, [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration, easing: carried ? EASE_OUT : EASE_IN, fill: 'forwards' });
          // Should the new period never come (nothing to draw), the old one comes back rather than staying away.
          void out?.finished.then(
            () => setTimeout(() => out.playState === 'finished' && out.cancel(), 800),
            () => {},
          );
          return out;
        });
        const glide = outs[0];
        if (carried && glide) {
          // The period changes once its neighbour is in place. A touch that stops the glide cancels it, and the change with it.
          void glide.finished.then(
            () => {
              arriveInPlace();
              stepRef.current(dir);
              peek(false);
            },
            () => {},
          );
          return;
        }
        slideNextFrom(SWIPE_SLIDE_PX);
      }
      // Drawn after a frame, so the slide has started on the compositor before the drawing holds the main thread.
      afterFrame(() => {
        stepRef.current(dir);
        peek(false);
      });
    };

    const onCancel = (e: PointerEvent) => {
      claimed.delete(e.pointerId);
      if (!g || e.pointerId !== g.pointerId) return;
      end(g.locked || g.base !== 0);
    };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onCancel);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onCancel);
      end(false);
      peek(false);
    };
  }, [ref, enabled]);
}
