// Finds a video-conference link in an event so it can be offered as a
// one-click "Join" action.
import { externalLink } from './externalLink';

const PROVIDERS: { name: string; pattern: RegExp }[] = [
  { name: 'Zoom', pattern: /https:\/\/(?:[a-z0-9-]+\.)?zoom\.(?:us|com)\/(?:j|my|w|s)\/[^\s<>"']+/i },
  { name: 'Microsoft Teams', pattern: /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s<>"']+/i },
  { name: 'Jitsi', pattern: /https:\/\/meet\.jit\.si\/[^\s<>"']+/i },
  { name: 'Webex', pattern: /https:\/\/(?:[a-z0-9-]+\.)?webex\.com\/[^\s<>"']+/i },
  { name: 'Whereby', pattern: /https:\/\/(?:[a-z0-9-]+\.)?whereby\.com\/[^\s<>"']+/i },
  { name: 'GoTo', pattern: /https:\/\/(?:meet\.goto\.com|(?:www\.)?gotomeet\.me|global\.gotomeeting\.com\/join)\/[^\s<>"']+/i },
  { name: 'Skype', pattern: /https:\/\/join\.skype\.com\/[^\s<>"']+/i },
];

// Many services, hosted and self-hosted, put their rooms on a "meet." host.
// Such a link is offered without a provider name and with its host: whoever
// wrote the event chose that host, and it may be anyone's.
const MEET_HOST = /https:\/\/meet\.[a-z0-9][a-z0-9.-]*(?::\d+)?\/[^\s<>"']+/i;

export interface MeetingLink {
  /** Name of the service, when the link is one of a known service. */
  provider?: string;
  /** Where a link without a provider leads, to be shown with it. */
  host?: string;
  url: string;
}

/** Only the start of a long text is searched: no real event hides its call link further in. */
const MAX_SEARCHED = 64 * 1024;

const TRAILING = '.,;:!?)]';

/**
 * Trailing punctuation belongs to the sentence, not the link. Cut by a loop
 * over the last characters: a pattern anchored at the end would start again
 * at every one of a long run of them, which takes quadratic time.
 */
function link(match: RegExpExecArray): string {
  const s = match[0];
  let end = s.length;
  while (end > 0 && TRAILING.includes(s[end - 1])) end--;
  return s.slice(0, end);
}

/** The host as the browser will see it, or nothing for an address it would not open (a port out of range). */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * The first conference link found in the given texts (checked in order).
 * Within one text a link of a known service wins over a "meet." host. Only
 * the first 64 KiB of each text are searched, and a link is offered only as
 * `externalLink` lets it through (2,048 characters at most).
 */
export function findMeetingLink(...texts: (string | undefined)[]): MeetingLink | undefined {
  for (const whole of texts) {
    if (!whole) continue;
    const text = whole.length > MAX_SEARCHED ? whole.slice(0, MAX_SEARCHED) : whole;
    for (const { name, pattern } of PROVIDERS) {
      const m = pattern.exec(text);
      const url = m ? link(m) : '';
      if (externalLink(url)) return { provider: name, url };
    }
    const m = MEET_HOST.exec(text);
    const url = m ? link(m) : '';
    // A room has a path; the front page of such a host is an ordinary link.
    const host = /^https:\/\/[^/]+\/./i.test(url) && externalLink(url) ? hostOf(url) : undefined;
    if (host) return { host, url };
  }
  return undefined;
}
