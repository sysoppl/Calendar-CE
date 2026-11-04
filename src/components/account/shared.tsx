// Small pieces the account and storage screens share: how a place is named
// and drawn, how much it holds, and how its state reads in one line.
import { useMemo, type ReactNode } from 'react';
import { MonitorSmartphone, Server, type LucideIcon } from 'lucide-react';
import { useData, isGeneratedCalendar, type Account } from '@/store/data';
import { errorMessage } from '@/store/ui';
import { useApp } from '@/store/app';
import { useSyncStatus } from '@/store/syncStatus';
import { useT, type TFunction } from '@/i18n';
import type { AccountKind } from '@/lib/backend';

export const KIND_ICON: Record<AccountKind, LucideIcon> = { local: MonitorSmartphone, caldav: Server };

/** What a place is called in a list of places: the kind for the device, the account's own name for CalDAV. */
export function accountTitle(account: Account, t: TFunction): string {
  if (account.kind === 'local') return t('storage.kind.local');
  return account.name;
}

/** The second line under the title: whose it is or where it lives. */
export function accountDetail(account: Account): string {
  if (account.kind === 'caldav') {
    let host = account.serverUrl ?? '';
    try {
      host = new URL(account.homeUrl ?? account.serverUrl ?? '').host;
    } catch {
      // Shown as typed.
    }
    return [account.username, host].filter(Boolean).join(' · ');
  }
  return '';
}

/**
 * A place as part of a sentence: "from this device", "to Nextcloud". Whole
 * phrases, because Polish declines the names and picks the preposition by
 * place ("na to urządzenie").
 */
export interface PlacePhrases {
  from: string;
  to: string;
  /** Where the source keeps things: "on this device". */
  inFrom: string;
  /** Where the destination keeps things: "on Nextcloud". */
  inTo: string;
}

function phrase(account: Account | undefined, role: 'from' | 'to' | 'in', t: TFunction): string {
  if (!account) return '';
  return account.kind === 'caldav' ? t(`migrate.place.${role}.caldav`, { name: account.name }) : t(`migrate.place.${role}.${account.kind}`);
}

export function placePhrases(source: Account | undefined, target: Account | undefined, t: TFunction): PlacePhrases {
  return { from: phrase(source, 'from', t), to: phrase(target, 'to', t), inFrom: phrase(source, 'in', t), inTo: phrase(target, 'in', t) };
}

export interface AccountStats {
  /** Calendars and task lists of its own (feeds and holidays do not count). */
  calendars: number;
  items: number;
}

/** Calendars and items per account, as this device holds them now. */
export function useAccountStats(): Record<string, AccountStats> {
  const calendars = useData((s) => s.calendars);
  const objects = useData((s) => s.objects);
  return useMemo(() => {
    const out: Record<string, AccountStats> = {};
    for (const cal of calendars) {
      if (isGeneratedCalendar(cal)) continue;
      const stats = (out[cal.accountId] ??= { calendars: 0, items: 0 });
      stats.calendars++;
      stats.items += Object.keys(objects[cal.id] ?? {}).length;
    }
    return out;
  }, [calendars, objects]);
}

export function statsText(stats: AccountStats | undefined, t: TFunction): string {
  const s = stats ?? { calendars: 0, items: 0 };
  return s.calendars ? t('storage.stats', { calendars: s.calendars, items: s.items }) : t('storage.statsEmpty');
}

/** The account new calendars go to (see `defaultAccountId`), reactive. */
export function useDefaultAccountId(): string {
  const mode = useApp((s) => s.storageMode);
  const accounts = useData((s) => s.accounts);
  const match = mode && mode !== 'local' ? accounts.find((a) => a.kind === mode) : undefined;
  return match?.id ?? 'local';
}

/** A message for the user. */
export function errorText(err: unknown): string {
  return errorMessage(err);
}

/**
 * The state of the calendars in one word, for the status line. Syncing is
 * not a state: the app syncs by itself all the time, and a line that flickers
 * with every round says nothing.
 *
 * - 'device': nothing is synced, everything is on this device;
 * - 'ok': every account is in step;
 * - 'offline': the browser has no connection;
 * - 'password': a CalDAV account needs its password again;
 * - 'unreachable': a server could not be reached;
 * - 'error': an account could not be synced for another reason.
 */
export type AccountState = 'device' | 'ok' | 'offline' | 'password' | 'unreachable' | 'error';

/** A CalDAV account whose password has to be entered again: the saved one cannot be read here, or the server refused it. */
export function needsPassword(account: Account): boolean {
  return account.kind === 'caldav' && (account.password === undefined || account.errorCode === 'auth');
}

/** What the state of the calendars is decided from. */
export interface StatusInput {
  accounts: Account[];
  online: boolean;
}

/** One state that holds, with what its line names. */
export interface StatusEntry {
  state: AccountState;
  /** The account it is about, for the states of one account. */
  account?: Account;
}

/**
 * Every state that holds now, the most important first: what keeps changes
 * from being saved, then failures of single accounts.
 * The last entry is always the plain state ('ok' or 'device').
 */
export function statusEntries(input: StatusInput): StatusEntry[] {
  const { accounts, online } = input;
  const remotes = accounts.filter((a) => a.kind !== 'local');
  const out: StatusEntry[] = [];
  if (remotes.length && !online) out.push({ state: 'offline' });
  const password = remotes.find(needsPassword);
  if (password) out.push({ state: 'password', account: password });
  const failures = remotes.filter((a) => a.error && a !== password);
  const unreachable = failures.find((a) => a.errorCode === 'network');
  if (unreachable) out.push({ state: 'unreachable', account: unreachable });
  const failed = failures.find((a) => a.errorCode !== 'network');
  if (failed) out.push({ state: 'error', account: failed });
  out.push({ state: remotes.length ? 'ok' : 'device' });
  return out;
}

/** The line that says a state. */
export function statusText(entry: StatusEntry, accounts: Account[], t: TFunction): string {
  switch (entry.state) {
    case 'offline':
      return t('status.offline');
    case 'password':
      return t('status.password', { name: entry.account?.name ?? '' });
    case 'unreachable':
      return t('status.unreachable');
    case 'error':
      return t('status.error', { name: entry.account?.name ?? '' });
    case 'device':
      return t('status.device');
    case 'ok': {
      const remotes = accounts.filter((a) => a.kind !== 'local');
      return remotes.length === 1 ? t('status.synced.server', { name: remotes[0].name }) : t('status.synced.servers');
    }
  }
}

/** The states that hold now, kept up to date. */
function useStatusEntries(): { entries: StatusEntry[]; accounts: Account[] } {
  const accounts = useData((s) => s.accounts);
  const online = useSyncStatus((s) => s.online);
  const entries = useMemo(() => statusEntries({ accounts, online }), [accounts, online]);
  return { entries, accounts };
}

export interface AccountSummary {
  /** The account the chip speaks for: where new calendars go. */
  account: Account | undefined;
  kind: AccountKind;
  title: string;
  /** Name of the kind, e.g. "On this device". */
  kindLabel: string;
  state: AccountState;
  /** One line about the state, e.g. "Synced with Nextcloud". */
  stateText: string;
  /** The account the state is about, when it is one account's (a CalDAV account whose password is needed). */
  stateAccount?: Account;
  /** Full text of a sync error, for a tooltip. */
  errorDetail?: string;
  /** A remote account exists, so "Try again" means something. */
  remote: boolean;
}

/** What the account chips show. */
export function useAccountSummary(): AccountSummary {
  const t = useT();
  const defaultId = useDefaultAccountId();
  const { entries, accounts } = useStatusEntries();

  const remotes = accounts.filter((a) => a.kind !== 'local');
  const account = accounts.find((a) => a.id === defaultId);
  const kind: AccountKind = account?.kind ?? 'local';
  const top = entries[0];

  const kindLabel = t(`storage.kind.${kind}`);
  const title = account ? accountTitle(account, t) : kindLabel;
  return {
    account,
    kind,
    title,
    kindLabel,
    state: top.state,
    stateText: statusText(top, accounts, t),
    stateAccount: top.account,
    errorDetail: top.state === 'error' || top.state === 'unreachable' || top.state === 'password' ? top.account?.error : undefined,
    remote: remotes.length > 0,
  };
}

/**
 * The state of one account, for its card in Settings: null where the card
 * has nothing to add (this device; an account not synced yet).
 */
export function accountStatusEntry(account: Account, input: Pick<StatusInput, 'online'>): StatusEntry | null {
  if (account.kind === 'local') return null;
  const top = statusEntries({ ...input, accounts: [account] })[0];
  if (top.state === 'ok') return account.lastSync ? { state: 'ok', account } : null;
  return top;
}

/**
 * Facts about one thing on one line, "a · b · c": a line breaks only between
 * them, so no fact is split ("items:" / "0"), and one too long for the line
 * (a long address) is cut short.
 */
export function MetaLine({ parts, className = '' }: { parts: (string | null | undefined | false)[]; className?: string }) {
  const shown = parts.filter((p): p is string => !!p);
  return (
    <span className={`text-text-weak block text-xs ${className}`}>
      {shown.map((part, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span className="inline-block max-w-full truncate align-bottom">
            {part}
            {i < shown.length - 1 && ' ·'}
          </span>
        </span>
      ))}
    </span>
  );
}

/** A small rounded label next to a title. */
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'primary' | 'success' | 'warning'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-bg-strong text-text-weak',
    // Accent-coloured text is too faint on the tint in some dark themes.
    primary: 'bg-primary-weak text-text',
    success: 'bg-success/15 text-text',
    warning: 'bg-warning/15 text-text',
  };
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${tones[tone]}`}>{children}</span>;
}

/**
 * Heading of a group inside the section. `major` for a main part of the
 * page, `first` for the one at the very top.
 */
export function GroupHeading({ id, children, action, major = false, first = false }: { id?: string; children: ReactNode; action?: ReactNode; major?: boolean; first?: boolean }) {
  return (
    // The parts of the page stand apart; on a phone, whose screen is short, by less.
    <div className={`mb-3 flex min-h-8 items-center gap-3 ${first ? 'mt-2' : major ? 'mt-6 sm:mt-12' : 'mt-8'}`}>
      <h3 id={id} className={`min-w-0 flex-1 font-semibold ${major ? 'text-base' : ''}`}>
        {children}
      </h3>
      {action}
    </div>
  );
}
