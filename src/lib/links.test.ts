import { describe, expect, it } from 'vitest';
import { legalLinks, servedLinks } from './links';

/** A page whose head holds the server's meta tag with `content` (null: no tag). */
const page = (content: string | null) => ({
  querySelector: (selector: string) =>
    selector === 'meta[name="calendar-links"]' && content !== null ? ({ getAttribute: (name: string) => (name === 'content' ? content : null) } as unknown as Element) : null,
});

describe('links the server wrote into the page', () => {
  it('are read from the meta tag', () => {
    const links = { privacy: 'https://example.org/privacy', terms: 'https://example.org/terms?lang=en&v=2', contact: 'mailto:hello@example.org' };
    expect(servedLinks(page(JSON.stringify(links)))).toEqual(links);
  });

  it('may set only some of the links', () => {
    expect(servedLinks(page('{"contact":"mailto:hello@example.org"}'))).toEqual({ contact: 'mailto:hello@example.org' });
  });

  it('are none without the tag, without a document, or when the tag is broken', () => {
    expect(servedLinks(page(null))).toEqual({});
    expect(servedLinks(undefined)).toEqual({});
    expect(servedLinks(page(''))).toEqual({});
    expect(servedLinks(page('{not json'))).toEqual({});
    expect(servedLinks(page('"https://example.org"'))).toEqual({});
    expect(servedLinks(page('null'))).toEqual({});
  });

  it('take only web and mailto: addresses', () => {
    const links = servedLinks(page(JSON.stringify({ privacy: 'javascript:alert(1)', terms: 42, contact: 'data:text/html,x', other: 'https://example.org' })));
    expect(links).toEqual({});
  });

  it('are shown in the order privacy, terms, contact', () => {
    expect(legalLinks({ privacy: '', terms: 'https://example.org/terms', contact: 'mailto:hello@example.org' })).toEqual([
      { key: 'terms', href: 'https://example.org/terms' },
      { key: 'contact', href: 'mailto:hello@example.org' },
    ]);
  });
});
