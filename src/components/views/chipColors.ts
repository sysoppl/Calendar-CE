import type { CSSProperties } from 'react';
import { calendarColor, readableTextOn, solidColor, withAlpha } from '@/lib/color';
import type { PartStat } from '@/lib/ical/types';
import type { EventStyle } from '@/store/settings';

export interface ChipColors {
  style: CSSProperties;
  textClass: string;
  subClass: string;
}

export interface ChipState {
  past?: boolean;
  tentative?: boolean;
  cancelled?: boolean;
  /** The user's reply when the event is an invitation. */
  reply?: PartStat;
}

const stripes = (a: string, b: string) => `repeating-linear-gradient(135deg, ${a}, ${a} 6px, ${b} 6px, ${b} 12px)`;
/** `c` as a tint over the page: `percent` of the colour, the rest the page's background. */
const tint = (c: string, percent: number) => `color-mix(in srgb, ${c} ${percent}%, var(--bg))`;

/**
 * Visual style of an event block for the chosen event style. Invitations show
 * their state: hollow until answered, striped
 * for "maybe", struck through when declined. `color` goes through the same
 * check as everywhere else a colour reaches CSS (`calendarColor`), so a chip
 * shows the named and translucent colours a dot of the same event shows.
 *
 * Past and declined events step back by colour, never by transparency, so
 * their text keeps its contrast: a filled block becomes a 45% tint of its
 * colour, a tonal or soft one an 18% tint, both with the page's own text; an
 * outline fades to half its colour, with the weaker text.
 */
export function chipColors(color: string, eventStyle: EventStyle, state: ChipState = {}): ChipColors {
  const own = calendarColor(color);
  // A block of colour is drawn solid; the soft style's tints keep the colour's own alpha.
  const c = solidColor(own);
  const tentative = state.tentative || state.reply === 'TENTATIVE';
  const declined = state.reply === 'DECLINED';
  const hollow = eventStyle === 'outline' || declined || state.reply === 'NEEDS-ACTION';
  const faded = state.past || declined;
  let style: CSSProperties;
  let subClass = 'text-text-weak';

  if (hollow) {
    const edge = faded ? withAlpha(own, 0.5) : c;
    style = { background: 'var(--bg)', color: faded ? 'var(--text-weak)' : 'var(--text)' };
    // A dashed edge needs an outline; a box shadow cannot be dashed.
    if (tentative) Object.assign(style, { outline: `1.5px dashed ${edge}`, outlineOffset: '-1.5px' });
    else style.boxShadow = `inset 0 0 0 1.5px ${edge}`;
  } else if (eventStyle === 'filled') {
    if (faded) {
      style = { background: tentative ? stripes(tint(c, 45), tint(c, 30)) : tint(c, 45), color: 'var(--text)' };
      subClass = 'opacity-85';
    } else {
      // The second line (the time) in the same colour: dimmed, it would fall under 4.5:1.
      style = { background: tentative ? stripes(c, withAlpha(own, 0.75)) : c, color: readableTextOn(own) };
      subClass = '';
    }
  } else if (eventStyle === 'tonal') {
    if (faded) {
      style = { background: tentative ? stripes(tint(c, 18), tint(c, 9)) : tint(c, 18), color: 'var(--text)' };
    } else {
      style = {
        background: tentative ? stripes(tint(c, 30), tint(c, 16)) : tint(c, 30),
        color: `color-mix(in srgb, ${c} 55%, var(--text))`,
      };
      subClass = '';
    }
  } else if (faded) {
    style = { background: tentative ? stripes(tint(c, 18), tint(c, 9)) : tint(c, 18), color: 'var(--text)', boxShadow: `inset 3px 0 0 ${withAlpha(own, 0.5)}` };
  } else {
    style = {
      background: tentative ? stripes(withAlpha(own, 0.2), withAlpha(own, 0.08)) : withAlpha(own, 0.18),
      color: 'var(--text)',
      boxShadow: `inset 3px 0 0 ${c}`,
    };
  }
  return { style, textClass: state.cancelled || declined ? 'line-through' : '', subClass };
}
