// Which e-mail addresses are "me". Needed to find the user's own reply among
// an event's attendees.
import type { Account } from '@/store/data';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Splits free text into valid, lower-case addresses. */
export function parseEmails(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => EMAIL.test(s)),
    ),
  ];
}

/**
 * The user's addresses per account: the address the server reports, a
 * username that is an address, and the ones entered in the settings.
 */
export function selfEmailsByAccount(accounts: Account[], extra: string): Map<string, Set<string>> {
  const shared = parseEmails(extra);
  return new Map(accounts.map((a) => [a.id, new Set([...shared, ...parseEmails(`${a.email ?? ''} ${a.username ?? ''}`)])]));
}
