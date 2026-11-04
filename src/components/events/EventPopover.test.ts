// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { findMeetingLink } from '@/lib/meeting';
import { JoinMeeting } from './EventPopover';

let root: Root;

afterEach(() => root.unmount());

/** The join button for the first meeting link in an event's description. */
function joinButton(description: string): HTMLAnchorElement {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  flushSync(() => root.render(h(JoinMeeting, { meeting: findMeetingLink(description)! })));
  return document.querySelector('a')!;
}

describe('JoinMeeting', () => {
  it('says where a link of no known service leads', () => {
    const a = joinButton('Agenda: https://meet.secure-login-portal.example/abc');
    expect(a.textContent).toBe('Join meetingmeet.secure-login-portal.example');
    expect(a.getAttribute('href')).toBe('https://meet.secure-login-portal.example/abc');
    expect(a.rel).toBe('noreferrer');
  });

  it('names a known service instead', () => {
    expect(joinButton('https://us02web.zoom.us/j/123456789').textContent).toBe('Join Zoom');
  });
});
