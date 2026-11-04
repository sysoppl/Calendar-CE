// @vitest-environment jsdom
import { createElement as h, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '@/store/ui';
import { arriveInPlace, IN_PLACE_MS, PERIOD_ANIMATION, REDUCED_MS, SLIDE_MS, slideNextFrom, usePeriodTransition, type TransitionKind } from './usePeriodTransition';

interface Played {
  el: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: { id: string; cancel: ReturnType<typeof vi.fn>; playState: string };
}

let played: Played[] = [];
let reduced = false;
let root: Root | null = null;

beforeEach(() => {
  played = [];
  reduced = false;
  // The Web Animations API, as far as the hook uses it.
  Element.prototype.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const animation = { id: String(options.id ?? ''), cancel: vi.fn(function (this: { playState: string }) { this.playState = 'idle'; }), playState: 'running' };
    played.push({ el: this, keyframes, options, animation });
    return animation as unknown as Animation;
  } as typeof Element.prototype.animate;
  Element.prototype.getAnimations = function (this: Element) {
    return played.filter((p) => p.el === this && p.animation.playState === 'running').map((p) => p.animation) as unknown as Animation[];
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('reduce') && reduced, media: query, addEventListener() {}, removeEventListener() {} }),
  });
  useUi.setState({ navDir: 0, viewSeq: 0 });
});

afterEach(() => {
  root?.unmount();
  root = null;
});

function Period({ period, kind }: { period: number; kind?: TransitionKind }) {
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  usePeriodTransition([a, b], period, kind);
  return h('div', null, h('div', { ref: a, id: 'a' }), h('div', { ref: b, id: 'b' }));
}

function show(period: number, kind?: TransitionKind) {
  if (!root) root = createRoot(document.body.appendChild(document.createElement('div')));
  flushSync(() => root!.render(h(Period, { period, kind })));
}

describe('usePeriodTransition', () => {
  it('slides the next period in from the right, every element of it, on the compositor only', () => {
    show(1);
    expect(played).toHaveLength(0);
    useUi.setState({ navDir: 1 });
    show(2);
    expect(played.map((p) => (p.el as HTMLElement).id)).toEqual(['a', 'b']);
    const [first] = played;
    expect(first.keyframes).toEqual([{ transform: 'translateX(24px)', opacity: 0 }, { transform: 'none', opacity: 1 }]);
    expect(first.options).toMatchObject({ duration: SLIDE_MS, id: PERIOD_ANIMATION });
    // Only what the compositor can move on its own.
    for (const p of played) for (const k of p.keyframes) expect(Object.keys(k).every((key) => key === 'transform' || key === 'opacity')).toBe(true);
  });

  it('slides the previous period in from the left', () => {
    show(1);
    useUi.setState({ navDir: -1 });
    show(0);
    expect(played[0].keyframes[0]).toEqual({ transform: 'translateX(-24px)', opacity: 0 });
  });

  it('cuts a slide short when the next change comes before it ended', () => {
    show(1);
    useUi.setState({ navDir: 1 });
    show(2);
    const first = played[0].animation;
    show(3);
    expect(first.cancel).toHaveBeenCalled();
    expect(played).toHaveLength(4);
  });

  it('only fades, briefly, when reduced motion is asked for', () => {
    reduced = true;
    show(1);
    useUi.setState({ navDir: 1 });
    show(2);
    expect(played[0].keyframes).toEqual([{ opacity: 0.6 }, { opacity: 1 }]);
    expect(played[0].options.duration).toBe(REDUCED_MS);
  });

  it('fades the lists instead of sliding them', () => {
    show(1, 'fade');
    useUi.setState({ navDir: 1 });
    show(2, 'fade');
    expect(played[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it('leaves a change without a direction alone (a setting moved the first day)', () => {
    show(1);
    useUi.setState({ navDir: 0 });
    show(2);
    expect(played).toHaveLength(0);
  });

  it('lets a view that a switch of view brought in grow in, once', () => {
    useUi.setState({ viewSeq: 7 });
    show(1);
    expect(played[0].keyframes).toEqual([{ transform: 'scale(0.985)', opacity: 0 }, { transform: 'none', opacity: 1 }]);
    root!.unmount();
    root = null;
    played = [];
    // Drawn again without a new switch: nothing.
    show(1);
    expect(played).toHaveLength(0);
  });

  it('starts further out after a swipe', () => {
    show(1);
    useUi.setState({ navDir: 1 });
    slideNextFrom(32);
    show(2);
    expect(played[0].keyframes[0]).toEqual({ transform: 'translateX(32px)', opacity: 0 });
    show(3);
    expect(played[2].keyframes[0]).toEqual({ transform: 'translateX(24px)', opacity: 0 });
  });

  it('leaves a period that a swipe slid into place where it is, once', () => {
    show(1);
    useUi.setState({ navDir: 1 });
    arriveInPlace();
    show(2);
    expect(played).toHaveLength(0);
    show(3);
    expect(played[0].keyframes[0]).toEqual({ transform: 'translateX(24px)', opacity: 0 });
  });

  it('forgets a period announced in place that did not come within a second', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      show(1);
      useUi.setState({ navDir: 1 });
      arriveInPlace();
      now.mockReturnValue(1_000_000 + IN_PLACE_MS + 1);
      show(2);
      expect(played).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });
});
