import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import type { Account } from '@/store/data';
import { accountStatusEntry, statusEntries, statusText, type StatusInput } from './shared';

const NOW = Date.UTC(2026, 9, 16, 12);

const local: Account = { id: 'local', kind: 'local', name: 'This device', useProxy: false };
const dav = (over: Partial<Account> = {}): Account => ({
  id: 'dav1',
  kind: 'caldav',
  name: 'Work',
  username: 'ada',
  serverUrl: 'https://dav.example.com/',
  password: 'secret',
  passwordBox: 'v1.a.b',
  useProxy: false,
  lastSync: NOW - 1000,
  ...over,
});

function input(over: Partial<StatusInput> = {}): StatusInput {
  return { accounts: [local, dav()], online: true, ...over };
}

const states = (i: StatusInput) => statusEntries(i).map((e) => e.state);
const top = (i: StatusInput) => statusEntries(i)[0].state;
const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('en', key, vars);
const text = (i: StatusInput) => statusText(statusEntries(i)[0], i.accounts, en);

describe('The status line (one state, the most important first)', () => {
  it('is calm when all is well, and never mentions a time', () => {
    expect(text(input({ accounts: [local] }))).toBe('On this device');
    expect(text(input())).toBe('Synced with Work');
    expect(text(input({ accounts: [local, dav(), dav({ id: 'dav2', name: 'Home' })] }))).toBe('Synced with your servers');
  });

  it('puts offline before the accounts', () => {
    const i = input({ online: false, accounts: [local, dav({ error: 'x', errorCode: 'network' })] });
    expect(states(i)).toEqual(['offline', 'unreachable', 'ok']);
    expect(text(i)).toBe("Offline - changes can't be saved");
  });

  it('says nothing about being offline with nothing to sync', () => {
    expect(top(input({ online: false, accounts: [local] }))).toBe('device');
  });

  it('asks for a CalDAV password before reporting servers that cannot be reached', () => {
    const i = input({ accounts: [local, dav({ id: 'a', name: 'A', error: 'down', errorCode: 'network' }), dav({ id: 'b', name: 'B', error: 'Sign-in failed', errorCode: 'auth' })] });
    expect(states(i)).toEqual(['password', 'unreachable', 'ok']);
    expect(text(i)).toBe('Enter the password for B again');
    // A password this device cannot read counts too.
    expect(top(input({ accounts: [local, dav({ password: undefined })] }))).toBe('password');
  });

  it('reports a server that cannot be reached before other failures', () => {
    const i = input({ accounts: [local, dav({ id: 'a', name: 'A', error: 'HTTP 500', errorCode: 'other' }), dav({ id: 'b', name: 'B', error: 'down', errorCode: 'network' })] });
    expect(states(i)).toEqual(['unreachable', 'error', 'ok']);
    expect(text(i)).toBe("Couldn't reach the server");
    expect(text({ ...i, accounts: [local, dav({ name: 'A', error: 'HTTP 500' })] })).toBe("Couldn't sync A");
  });

  it('says each state in Polish too', () => {
    const pl = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('pl', key, vars);
    for (const i of [input({ accounts: [local] }), input(), input({ online: false }), input({ accounts: [local, dav({ password: undefined })] })]) {
      const entry = statusEntries(i)[0];
      expect(statusText(entry, i.accounts, pl)).not.toBe(statusText(entry, i.accounts, en));
    }
  });
});

describe('The state on an account card', () => {
  const base = { online: true };

  it('says nothing for this device, or an account not synced yet', () => {
    expect(accountStatusEntry(local, base)).toBeNull();
    expect(accountStatusEntry(dav({ lastSync: undefined }), base)).toBeNull();
  });

  it('is the account own state', () => {
    expect(accountStatusEntry(dav(), base)?.state).toBe('ok');
    expect(accountStatusEntry(dav({ error: 'x', errorCode: 'network' }), base)?.state).toBe('unreachable');
    expect(accountStatusEntry(dav({ error: 'x', errorCode: 'other' }), base)?.state).toBe('error');
    expect(accountStatusEntry(dav({ errorCode: 'auth', error: 'no' }), base)?.state).toBe('password');
    expect(accountStatusEntry(dav(), { ...base, online: false })?.state).toBe('offline');
  });
});
