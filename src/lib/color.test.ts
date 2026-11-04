import { describe, expect, it } from 'vitest';
import { CSS_COLOR_NAMES, calendarColor, contrastRatio, DARK_TEXT, DEFAULT_CALENDAR_COLOR, DEFAULT_TASK_COLOR, eventColor, mixHex, normalizeItemColor, readableText, readableTextOn, solidColor, withAlpha } from './color';

describe('normalizeItemColor', () => {
  it('keeps a hex colour and a CSS colour keyword', () => {
    expect(normalizeItemColor('#3a7')).toBe('#3a7');
    expect(normalizeItemColor('#AbCdEf')).toBe('#AbCdEf');
    expect(normalizeItemColor(' #123456 ')).toBe('#123456');
    expect(normalizeItemColor('turquoise')).toBe('turquoise');
    expect(normalizeItemColor(' DarkSlateGrey ')).toBe('darkslategrey');
    expect(normalizeItemColor('lightgoldenrodyellow')).toBe('lightgoldenrodyellow');
  });

  it('keeps a hex colour with an alpha channel, which other clients write', () => {
    expect(normalizeItemColor('#f008')).toBe('#f008');
    expect(normalizeItemColor('#ff000080')).toBe('#ff000080');
  });

  it.each([
    'url(https://tracker.example/beacon?u=victim)',
    'expression(alert(1))',
    'red;}body{background:url(https://tracker.example/x)}',
    'red; background-image: url(x)',
    '#ff0000;background:url(x)',
    '#ff0000 url(x)',
    'var(--primary)',
    'rgb(1, 2, 3)',
    'red!important',
    'notacolor',
    'transparent',
    'currentcolor',
    'inherit',
    '#12',
    '#12345',
    '#1234567',
    '#123456789',
    '#ggg',
    '123456',
    'red\u0000',
    '',
  ])('drops %j', (value) => {
    expect(normalizeItemColor(value)).toBeUndefined();
  });

  it('drops very long values without looking at all of them', () => {
    expect(normalizeItemColor('a'.repeat(1_000_000))).toBeUndefined();
    expect(normalizeItemColor(`#fff${' '.repeat(1_000_000)}`)).toBeUndefined();
    expect(normalizeItemColor(`red${';'.repeat(100)}`)).toBeUndefined();
    expect(normalizeItemColor(undefined)).toBeUndefined();
  });

  it('only hands on what eventColor accepts as well', () => {
    for (const value of ['#3a7', '#f008', '#123456', '#ff000080', 'turquoise', 'DarkSlateGrey']) {
      const kept = normalizeItemColor(value)!;
      expect(eventColor(kept, '#000000')).toBe(kept);
    }
  });

  it('agrees with eventColor on what is a colour', () => {
    for (const value of ['#1234567', '#12345', 'notacolor', 'transparent', 'url(x)', 'rgb(1, 2, 3)']) {
      expect(normalizeItemColor(value)).toBeUndefined();
      expect(eventColor(value, '#000000')).toBe('#000000');
    }
  });
});

describe('colours as they reach CSS', () => {
  it('check a calendar colour by the same rule as an event colour', () => {
    expect(calendarColor('#3a7')).toBe('#3a7');
    expect(calendarColor(' Turquoise ')).toBe('turquoise');
    expect(calendarColor('#ff000080')).toBe('#ff000080');
    expect(calendarColor('url(https://tracker.example/x)')).toBe(DEFAULT_CALENDAR_COLOR);
    expect(calendarColor(undefined, DEFAULT_TASK_COLOR)).toBe(DEFAULT_TASK_COLOR);
    // An event without a colour of its own takes the calendar's, checked too.
    expect(eventColor(undefined, 'red;background:url(x)')).toBe(DEFAULT_CALENDAR_COLOR);
    expect(eventColor(undefined, 'navy')).toBe('navy');
  });

  it('know the value of every colour keyword', () => {
    expect(CSS_COLOR_NAMES).toHaveLength(147);
    for (const name of CSS_COLOR_NAMES) expect(normalizeItemColor(name), name).toBe(name);
    expect(withAlpha('rebeccapurple', 0.5)).toBe('rebeccapurple');
    expect(withAlpha('turquoise', 0.18)).toBe('rgba(64, 224, 208, 0.18)');
    expect(withAlpha('LightGoldenrodYellow', 1)).toBe('rgba(250, 250, 210, 1)');
  });

  it('pick text that reads on named and translucent colours', () => {
    expect(readableText('yellow')).toBe(DARK_TEXT);
    expect(readableText('navy')).toBe('#ffffff');
    expect(readableText('#ff08')).toBe(readableText('#ffff00'));
    expect(readableText('#000080cc')).toBe('#ffffff');
    // Translucent: what reads over a light page and a dark one alike, else the page's own text colour.
    expect(readableTextOn('#00008040')).toBe('var(--text)');
    expect(readableTextOn('#ff000080')).toBe('var(--text)');
    expect(readableTextOn('#000080cc')).toBe('#ffffff');
    expect(readableTextOn('#ffff00f0')).toBe(DARK_TEXT);
    expect(readableTextOn('yellow')).toBe(DARK_TEXT);
    expect(readableTextOn('navy')).toBe('#ffffff');
  });

  it('give a colour with an alpha channel both alphas, and draw it solid over the page', () => {
    expect(withAlpha('#ff000080', 0.5)).toBe('rgba(255, 0, 0, 0.251)');
    expect(withAlpha('#f008', 1)).toBe('rgba(255, 0, 0, 0.533)');
    expect(withAlpha('#3a7', 0.18)).toBe('rgba(51, 170, 119, 0.18)');
    expect(solidColor('#ff000080')).toBe('color-mix(in srgb, rgb(255, 0, 0) 50%, var(--bg))');
    expect(solidColor('#ff0000ff')).toBe('#ff0000ff');
    expect(solidColor('turquoise')).toBe('turquoise');
    expect(solidColor('#123456')).toBe('#123456');
  });
});

describe('text on a block of colour', () => {
  it('is white wherever white meets WCAG AA, else whichever of white and the dark text reads better', () => {
    expect(DARK_TEXT).toBe('#141619');
    // The violet of before: white reaches only 3.61:1 on it.
    expect(readableText('#9171f0')).toBe(DARK_TEXT);
    expect(readableText('#007c73')).toBe('#ffffff');
    expect(readableText('#af8700')).toBe(DARK_TEXT);
    expect(readableText('#d12e2c')).toBe('#ffffff');
    expect(readableText('#e83557')).toBe(DARK_TEXT);
    expect(readableText('#3e2ea8')).toBe('#ffffff');
    expect(readableText('#000000')).toBe('#ffffff');
    expect(readableText('#ffffff')).toBe(DARK_TEXT);
    // Not a colour: white, as before.
    expect(readableText('url(x)')).toBe('#ffffff');
  });

  it('never picks a text under 4.5:1 where the other one reaches it', () => {
    for (let v = 0; v < 256; v += 5) {
      for (const bg of [mixHex('#000000', '#ffffff', v / 255), mixHex('#ff0000', '#00ffff', v / 255), mixHex('#0000ff', '#ffff00', v / 255)]) {
        const text = readableText(bg);
        const other = text === '#ffffff' ? DARK_TEXT : '#ffffff';
        // White is kept wherever it reads.
        if (contrastRatio('#ffffff', bg) >= 4.5) expect(text, bg).toBe('#ffffff');
        expect(contrastRatio(text, bg), bg).toBeGreaterThanOrEqual(Math.min(4.5, contrastRatio(other, bg)));
      }
    }
  });
});

describe('contrastRatio and mixHex', () => {
  it('measure the WCAG ratio either way round', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#0a7268', '#ffffff')).toBeCloseTo(5.8, 1);
    expect(contrastRatio('#0e8a7e', '#ffffff')).toBeCloseTo(4.24, 1);
    expect(contrastRatio('white', 'black')).toBeCloseTo(21, 5);
    expect(contrastRatio('url(x)', '#000000')).toBe(1);
  });

  it('mix in sRGB like CSS color-mix, to #rrggbb', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#3a7', '#3a7', 0)).toBe('#33aa77');
    expect(mixHex('#ff0000', '#0000ff', 2)).toBe('#0000ff');
    expect(mixHex('#ff0000', '#0000ff', -1)).toBe('#ff0000');
  });
});
