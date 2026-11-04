// @vitest-environment jsdom
import { act, createElement as h, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimSwipe, peersShown, rubberBand, shouldCommit, SPRING_MS, swipeDecision, useSwipePager, VelocityTracker } from './useSwipePager';
import { EASE_OUT } from './usePeriodTransition';

describe('what a released swipe does', () => {
  it('changes the period past 22 % of the width or with a flick', () => {
    expect(shouldCommit(80, 0.1, 360)).toBe(true);
    expect(shouldCommit(60, 0.1, 360)).toBe(false);
    expect(shouldCommit(30, 0.5, 360)).toBe(true);
    expect(shouldCommit(-30, -0.5, 360)).toBe(true);
  });

  it('goes to the next period when the finger went left, the previous one when it went right', () => {
    expect(swipeDecision(-90, 0, 360)).toBe(1);
    expect(swipeDecision(90, 0, 360)).toBe(-1);
  });

  it('springs back when the finger flicked back towards where it started', () => {
    expect(swipeDecision(-120, 0.6, 360)).toBe(0);
  });

  it('follows the finger one to one, then with resistance past 40 % of the width', () => {
    expect(rubberBand(100, 360)).toBe(100);
    expect(rubberBand(144, 360)).toBe(144);
    expect(rubberBand(244, 360)).toBeCloseTo(144 + 100 * 0.3);
    expect(rubberBand(-244, 360)).toBeCloseTo(-(144 + 100 * 0.3));
  });

  it('measures the speed over the last 80 ms', () => {
    const v = new VelocityTracker();
    v.add(0, 0);
    v.add(10, 100);
    v.add(30, 150);
    v.add(70, 170);
    expect(v.velocity()).toBeCloseTo((70 - 10) / 70);
    expect(new VelocityTracker().velocity()).toBe(0);
  });
});

let root: Root | null = null;
let host: HTMLElement;
const steps: number[] = [];

function Pager({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useSwipePager(ref, { enabled, onStep: (dir) => steps.push(dir) });
  return h('div', { ref, id: 'pager' }, h('div', { 'data-pager': '', id: 'content' }, 'October'));
}

beforeEach(() => {
  vi.useFakeTimers();
  steps.length = 0;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  flushSync(() => root!.render(h(Pager)));
  Object.defineProperty(host.querySelector('#pager')!, 'clientWidth', { configurable: true, value: 360 });
});

afterEach(() => {
  root?.unmount();
  root = null;
  vi.useRealTimers();
});

let next = 100;
function swipe(points: [number, number][], { pointerType = 'touch', id = next++, gap = 16 }: { pointerType?: string; id?: number; gap?: number } = {}) {
  const el = host.querySelector('#content')!;
  let t = 0;
  const fire = (type: string, [x, y]: [number, number]) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id, pointerType, isPrimary: true }));
  fire('pointerdown', points[0]);
  for (const p of points.slice(1)) {
    t += gap;
    vi.advanceTimersByTime(gap);
    fire('pointermove', p);
  }
  fire('pointerup', points[points.length - 1]);
  return id;
}

const content = () => host.querySelector<HTMLElement>('#content')!;

describe('useSwipePager', () => {
  it('pages to the next period on a swipe to the left, after the slide has started', () => {
    swipe([[300, 200], [290, 201], [250, 202], [180, 203], [150, 203]]);
    expect(steps).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(steps).toEqual([1]);
  });

  it('moves the content with the finger while it is held', () => {
    const el = content();
    const fire = (type: string, x: number) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: 100, pointerId: 7, pointerType: 'touch', isPrimary: true }));
    fire('pointerdown', 100);
    fire('pointermove', 115);
    fire('pointermove', 160);
    vi.advanceTimersByTime(20);
    expect(el.style.transform).toBe('translateX(60px)');
    fire('pointercancel', 160);
  });

  it('leaves a mostly vertical move to the scrolling', () => {
    swipe([[200, 100], [195, 120], [150, 300]]);
    vi.advanceTimersByTime(50);
    expect(steps).toEqual([]);
    expect(content().style.transform).toBe('');
  });

  it('springs back from a short, slow swipe', () => {
    swipe([[200, 100], [215, 100], [230, 100], [245, 100]], { gap: 60 });
    vi.advanceTimersByTime(50);
    expect(steps).toEqual([]);
  });

  it('lets go of a touch that picked an event up', () => {
    const id = next++;
    claimSwipe(id);
    swipe([[300, 200], [250, 200], [100, 200]], { id });
    vi.advanceTimersByTime(50);
    expect(steps).toEqual([]);
  });

  it('is for fingers only, and off where it is not wanted', () => {
    swipe([[300, 200], [250, 200], [100, 200]], { pointerType: 'mouse' });
    vi.advanceTimersByTime(50);
    expect(steps).toEqual([]);
    flushSync(() => root!.render(h(Pager, { enabled: false })));
    swipe([[300, 200], [250, 200], [100, 200]]);
    vi.advanceTimersByTime(50);
    expect(steps).toEqual([]);
  });
});

const peeks: boolean[] = [];

/** A pager whose view draws the periods beside the current one when asked to, as the calendar's do. */
function Carousel() {
  const ref = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState(false);
  useSwipePager(ref, {
    enabled: true,
    onStep: (dir) => steps.push(dir),
    onPeek: (on) => {
      peeks.push(on);
      setPeek(on);
    },
  });
  return h(
    'div',
    { ref, id: 'pager' },
    h('div', { 'data-pager': '', id: 'content' }, 'October', peek && h('div', { 'data-pager-peer': '-1' }, 'September'), peek && h('div', { 'data-pager-peer': '1' }, 'November')),
  );
}

interface Played {
  el: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: { id: string; playState: string; finished: Promise<unknown>; cancel: () => void; finish: () => void };
}

describe('the periods beside the current one', () => {
  let played: Played[] = [];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    peeks.length = 0;
    played = [];
    // The Web Animations API, as far as the pager uses it; each animation finishes when a test says so.
    Element.prototype.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      let resolve = (_: unknown) => {};
      let reject = (_: unknown) => {};
      const finished = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const animation = {
        id: String(options.id ?? ''),
        playState: 'running',
        finished,
        cancel() {
          if (this.playState === 'running') reject(new DOMException('cancelled', 'AbortError'));
          this.playState = 'idle';
        },
        finish() {
          this.playState = 'finished';
          resolve(this);
        },
      };
      played.push({ el: this, keyframes, options, animation });
      return animation as unknown as Animation;
    } as typeof Element.prototype.animate;
    Element.prototype.getAnimations = function (this: Element) {
      return played.filter((p) => p.el === this && p.animation.playState === 'running').map((p) => p.animation) as unknown as Animation[];
    };
    act(() => root!.render(h(Carousel)));
    Object.defineProperty(host.querySelector('#pager')!, 'clientWidth', { configurable: true, value: 360 });
  });

  afterEach(() => {
    delete (Element.prototype as { animate?: unknown }).animate;
    delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  const fire = (type: string, x: number, y = 200, id = 61) => content().dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id, pointerType: 'touch', isPrimary: true }));
  /** A finger from x 300 to the left, held down at `to`. */
  const pull = (to: number) =>
    act(() => {
      fire('pointerdown', 300);
      for (const x of [285, 240, to]) {
        vi.advanceTimersByTime(16);
        fire('pointermove', x);
      }
    });

  it('are drawn once a swipe is sideways, and not for a vertical move', () => {
    act(() => {
      fire('pointerdown', 200, 100, 62);
      fire('pointermove', 195, 120, 62);
      fire('pointermove', 190, 300, 62);
      fire('pointerup', 190, 300, 62);
    });
    expect(peeks).toEqual([]);
    pull(180);
    expect(peeks).toEqual([true]);
    expect(peersShown([content()], 1)).toBe(true);
    expect(peersShown([content()], -1)).toBe(true);
  });

  it('glide the next one into place, and only then is the period changed, with nothing more to animate', async () => {
    pull(200);
    act(() => fire('pointerup', 200));
    const glide = played.find((p) => p.el === content())!;
    expect(glide.keyframes).toEqual([{ transform: 'translateX(-100px)' }, { transform: 'translateX(-360px)' }]);
    expect(glide.options.easing).toBe(EASE_OUT);
    act(() => vi.advanceTimersByTime(50));
    expect(steps).toEqual([]);
    await act(async () => glide.animation.finish());
    expect(steps).toEqual([1]);
    expect(peeks).toEqual([true, false]);
  });

  it('stay when a new touch catches the glide, which then changes nothing', async () => {
    pull(150);
    act(() => fire('pointerup', 150));
    const glide = played.find((p) => p.el === content())!;
    await act(async () => fire('pointerdown', 200, 200, 63));
    expect(glide.animation.playState).toBe('idle');
    act(() => vi.advanceTimersByTime(50));
    expect(steps).toEqual([]);
    expect(peeks).toEqual([true]);
  });

  it('go once a short swipe has sprung back', () => {
    act(() => {
      fire('pointerdown', 200);
      for (const x of [215, 230, 245]) {
        vi.advanceTimersByTime(60);
        fire('pointermove', x);
      }
      fire('pointerup', 245);
    });
    expect(steps).toEqual([]);
    expect(peeks).toEqual([true]);
    act(() => vi.advanceTimersByTime(SPRING_MS));
    expect(peeks).toEqual([true, false]);
    expect(peersShown([content()], 1)).toBe(false);
  });

  it('are not drawn with reduced motion, where the period just changes', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }) });
    pull(150);
    act(() => fire('pointerup', 150));
    act(() => vi.advanceTimersByTime(50));
    expect(steps).toEqual([1]);
    expect(peeks.filter(Boolean)).toEqual([]);
  });
});
