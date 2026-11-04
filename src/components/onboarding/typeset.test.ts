import { describe, expect, it } from 'vitest';
import { typeset } from './typeset';

describe('typeset', () => {
  it('keeps one-letter Polish words and dashes with their neighbours', () => {
    expect(typeset('Kalendarz w tej przeglądarce i nie jest wysyłany – nigdzie.', 'pl')).toBe('Kalendarz w\u00a0tej przeglądarce i\u00a0nie jest wysyłany\u00a0– nigdzie.');
    expect(typeset('Z serwerem', 'pl')).toBe('Z\u00a0serwerem');
  });

  it('leaves other languages alone', () => {
    expect(typeset('Stored in a browser – here.', 'en')).toBe('Stored in a browser – here.');
  });
});
