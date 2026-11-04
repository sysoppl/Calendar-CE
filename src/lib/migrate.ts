// Moving calendars from one account to another: from this device to a server,
// between servers, or back.
//
// Nothing is removed from the source until every item of it, as it is in the
// source now, has been seen in the target after a full listing of both, and
// a run can be interrupted at any point. A small journal in localStorage
// remembers which target calendar belongs to which source calendar and a
// fingerprint of every item copied; together with "skip the UIDs that are
// already there, unless the item changed since it was copied" that makes a
// second run continue the first instead of duplicating it.
import { t } from '@/i18n';
import { carryCalendarAlarms } from '@/lib/calendarAlarms';
import { isGeneratedCalendar, isUnreadable, onAccountRemoved, staleCalendars, uidOf, useData, type Calendar } from '@/store/data';
import { useSettings } from '@/store/settings';

const JOURNAL_KEY = 'calendar.migration';

export interface MigrationPlanCalendar {
  /** Id of the calendar in the source account. */
  id: string;
  name: string;
  /** Objects it holds right now. */
  items: number;
  /** Shared by someone else: it is copied, and never deleted. */
  readOnly: boolean;
  /** Its items could not be read from the device: nothing of it is copied or deleted. */
  unreadable?: true;
}

export interface MigrationPlan {
  sourceAccountId: string;
  targetAccountId: string;
  calendars: MigrationPlanCalendar[];
  /** Feeds and holiday calendars. They belong to the device and are not moved. */
  generated: { id: string; name: string }[];
  items: number;
  /** A run between these two accounts was interrupted and will be continued. */
  resumes: boolean;
}

export type MigrationPhase = 'prepare' | 'copy' | 'verify' | 'delete' | 'done';

export interface MigrationProgress {
  phase: MigrationPhase;
  /** The calendar being worked on, while copying and deleting. */
  calendarId?: string;
  calendarName?: string;
  calendarIndex: number;
  calendarCount: number;
  /** Items copied so far and items to copy, over all calendars. */
  done: number;
  total: number;
}

export interface MigratedCalendar {
  sourceId: string;
  targetId: string;
  name: string;
  /** Items written to the target by this run. */
  copied: number;
  /** Items the target had already (from an earlier run, usually). */
  present: number;
  /** Items without a readable UID. They cannot be copied and stay where they are. */
  unreadable: number;
  /** Every item of the source was found in the target. */
  verified: boolean;
  /** The source calendar was removed. */
  deleted: boolean;
  /**
   * Why the source calendar is still there although removal was asked for.
   * `unverified` and `failed` may be gone after another run; the others not.
   */
  kept?: 'read-only' | 'unreadable' | 'unverified' | 'failed';
  /** What went wrong, for `failed`. */
  error?: string;
}

export interface MigrationResult {
  calendars: MigratedCalendar[];
  generated: { id: string; name: string }[];
  copied: number;
  present: number;
  unreadable: number;
  /** Nothing is left that another run could do. The journal is cleared then, and only then. */
  complete: boolean;
  /** The source account has no calendars of its own any more. */
  sourceEmpty: boolean;
}

export interface MigrationOptions {
  /** Remove each source calendar once its copy is verified. Off: the source is left untouched. */
  deleteSource?: boolean;
  onProgress?: (progress: MigrationProgress) => void;
  signal?: AbortSignal;
}

export interface MigrationJournal {
  v: 1;
  sourceAccountId: string;
  targetAccountId: string;
  deleteSource: boolean;
  startedAt: number;
  /**
   * Source calendar id to target calendar id, written the moment the target
   * exists and kept after the source is deleted: a device that lost the
   * deletion half-way (objects gone, calendar list not yet saved) shows the
   * source again, empty, and it must find its copy instead of getting a twin.
   */
  calendars: Record<string, string>;
  /**
   * Per source calendar, a fingerprint of each item as it was copied (keyed
   * by a fingerprint of its UID). An item that differs from it now was
   * changed after it was copied, and is copied again before anything goes.
   */
  copied?: Record<string, Record<string, string>>;
}

// Without localStorage a run still works; it just cannot be continued after a restart.
let fallback: MigrationJournal | null = null;

function readJournal(): MigrationJournal | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(JOURNAL_KEY);
  } catch {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw ?? 'null') as MigrationJournal | null;
    const sound = !!parsed && parsed.v === 1 && typeof parsed.sourceAccountId === 'string' && typeof parsed.targetAccountId === 'string' && !!parsed.calendars && typeof parsed.calendars === 'object';
    return sound ? parsed : null;
  } catch {
    return null;
  }
}

/** A short fingerprint of a text (cyrb53): enough to tell that an item changed, not meant to resist anyone. */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function writeJournal(journal: MigrationJournal | null) {
  try {
    if (journal) localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
    else localStorage.removeItem(JOURNAL_KEY);
    fallback = null;
  } catch {
    fallback = journal;
  }
}

const store = () => useData.getState();
const calendarById = (id: string | undefined) => store().calendars.find((c) => c.id === id);
const objectsOf = (id: string) => Object.values(store().objects[id] ?? {});
/** A local calendar whose items could not be read from the device: what the store shows for it is not what it holds. */
const unread = (cal: Calendar) => isUnreadable(cal.id) || !(cal.id in store().objects);

function ownCalendars(accountId: string): Calendar[] {
  return store()
    .calendars.filter((c) => c.accountId === accountId && !isGeneratedCalendar(c))
    .sort((a, b) => a.order - b.order);
}

/**
 * Syncs an account and insists that all of it arrived. A sync that failed for
 * single calendars still resolves; here that is not good enough, because
 * what is missing would not be copied and could then be deleted. `full`
 * lists every calendar whole instead of asking for changes: what a server
 * said it stored is then checked against what it lists.
 */
async function syncCompletely(accountId: string, full = false) {
  await store().syncAccount(accountId, { full });
  if (staleCalendars(accountId).length) {
    throw new Error(store().accounts.find((a) => a.id === accountId)?.error ?? t('migrate.error.syncFailed'));
  }
}

function requireAccounts(sourceAccountId: string, targetAccountId: string) {
  if (sourceAccountId === targetAccountId) throw new Error(t('migrate.error.sameAccount'));
  for (const id of [sourceAccountId, targetAccountId]) {
    if (!store().accounts.some((a) => a.id === id)) throw new Error(t('migrate.error.unknownAccount'));
  }
}

/** Read-only for good here: copied, never deleted. */
function keptReadOnly(cal: Calendar): boolean {
  return cal.readOnly;
}

/** The run that was interrupted, if its accounts still exist. */
export function pendingMigration(): MigrationJournal | null {
  const journal = readJournal();
  if (!journal) return null;
  const known = [journal.sourceAccountId, journal.targetAccountId].every((id) => store().accounts.some((a) => a.id === id));
  return known ? journal : null;
}

/** Forgets an interrupted run. What it copied stays where it is. */
export function clearMigration() {
  writeJournal(null);
}

/**
 * Forgets an interrupted run from or to an account that leaves this device
 * (removed, replaced by another): the journal names the account and its
 * calendars, and holds a fingerprint of every item it copied.
 */
export function forgetMigrationOf(accountId: string) {
  const journal = readJournal();
  if (journal && (journal.sourceAccountId === accountId || journal.targetAccountId === accountId)) writeJournal(null);
}

// The journal (fingerprints of what was copied, the accounts' ids) goes with an account that is removed, of any kind.
onAccountRemoved(forgetMigrationOf);

/** What a move from one account to another would cover, from what is known right now. */
export function planMigration(sourceAccountId: string, targetAccountId: string): MigrationPlan {
  requireAccounts(sourceAccountId, targetAccountId);
  const calendars = ownCalendars(sourceAccountId).map(
    (c): MigrationPlanCalendar => ({ id: c.id, name: c.name, items: objectsOf(c.id).length, readOnly: keptReadOnly(c), ...(unread(c) ? { unreadable: true } : {}) }),
  );
  const journal = pendingMigration();
  return {
    sourceAccountId,
    targetAccountId,
    calendars,
    generated: store()
      .calendars.filter((c) => c.accountId === sourceAccountId && isGeneratedCalendar(c))
      .map((c) => ({ id: c.id, name: c.name })),
    items: calendars.reduce((sum, c) => sum + c.items, 0),
    resumes: !!journal && journal.sourceAccountId === sourceAccountId && journal.targetAccountId === targetAccountId && Object.keys(journal.calendars).length > 0,
  };
}

interface Pending {
  items: { uid: string; data: string }[];
  present: number;
  unreadable: number;
}

/**
 * What of `source` is not in `target` yet. Items are matched by UID; one this
 * run copied counts only while it is still what was copied (see
 * `MigrationJournal.copied`).
 */
function pendingItems(source: Calendar, target: Calendar | undefined, copied: Record<string, string> = {}): Pending {
  const there = new Set<string>();
  if (target) {
    for (const raw of objectsOf(target.id)) {
      const uid = uidOf(raw);
      if (uid) there.add(uid);
    }
  }
  const out: Pending = { items: [], present: 0, unreadable: 0 };
  // Two items with one UID are stored as one, the later (see importObjects).
  const byUid = new Map<string, string>();
  for (const raw of objectsOf(source.id)) {
    const uid = uidOf(raw);
    if (uid) byUid.set(uid, raw.data);
    else out.unreadable++;
  }
  for (const [uid, data] of byUid) {
    const was = copied[fingerprint(uid)];
    if (there.has(uid) && (was === undefined || was === fingerprint(data))) out.present++;
    else out.items.push({ uid, data });
  }
  return out;
}

/**
 * An empty calendar in the target with the same name and kind can take the
 * place of a new one: the default "My calendar" of a fresh account, or one
 * that an earlier run created just before it was cut off.
 */
function adoptable(source: Calendar, targetAccountId: string, taken: Set<string>): Calendar | undefined {
  const name = source.name.trim().toLowerCase();
  const kind = [...source.components].sort().join();
  return ownCalendars(targetAccountId).find(
    (c) =>
      !c.readOnly &&
      !taken.has(c.id) &&
      c.name.trim().toLowerCase() === name &&
      [...c.components].sort().join() === kind &&
      c.id in store().objects &&
      objectsOf(c.id).length === 0,
  );
}

/**
 * Copies the calendars of the plan into the target account, and with
 * `deleteSource` removes them from the source afterwards. Resolves with what
 * happened to each calendar; rejects (leaving a journal to continue from)
 * when either account cannot be reached or the run is aborted.
 *
 * Which account new calendars go to (`useApp().setStorageMode`) is left to
 * the caller, as is removing a source account that ended up empty.
 */
export async function runMigration(plan: MigrationPlan, options: MigrationOptions = {}): Promise<MigrationResult> {
  const { sourceAccountId, targetAccountId } = plan;
  requireAccounts(sourceAccountId, targetAccountId);
  const deleteSource = !!options.deleteSource;
  const checkAborted = () => {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
  };

  let journal = readJournal();
  if (!journal || journal.sourceAccountId !== sourceAccountId || journal.targetAccountId !== targetAccountId) {
    journal = { v: 1, sourceAccountId, targetAccountId, deleteSource, startedAt: Date.now(), calendars: {} };
  }
  journal.deleteSource = deleteSource;
  if (typeof journal.copied !== 'object' || journal.copied === null) journal.copied = {};
  const prints = journal.copied;
  const copiedFrom = (id: string) => (prints[id] ??= {});
  writeJournal(journal);

  let done = 0;
  let total = plan.items;
  let count = plan.calendars.length;
  const report = (phase: MigrationPhase, index = 0, cal?: Calendar) => {
    options.onProgress?.({ phase, calendarId: cal?.id, calendarName: cal?.name, calendarIndex: index, calendarCount: count, done: Math.min(done, total), total });
  };

  // Both ends as they are now: what gets copied, what counts as present and
  // what may be deleted later is all decided from the store.
  report('prepare');
  await syncCompletely(sourceAccountId);
  await syncCompletely(targetAccountId);
  checkAborted();

  const planned = new Set(plan.calendars.map((c) => c.id));
  const sources = ownCalendars(sourceAccountId).filter((c) => planned.has(c.id));
  count = sources.length;
  total = sources.reduce((sum, c) => sum + pendingItems(c, calendarById(journal.calendars[c.id]), copiedFrom(c.id)).items.length, 0);

  const results = new Map<string, MigratedCalendar>();
  for (const [index, source] of sources.entries()) {
    checkAborted();
    report('copy', index, source);
    if (unread(source)) {
      // Nothing of it could be read here: "copying" it would copy nothing,
      // and deleting it afterwards would lose all of it.
      results.set(source.id, { sourceId: source.id, targetId: '', name: source.name, copied: 0, present: 0, unreadable: 0, verified: false, deleted: false, kept: 'unreadable' });
      continue;
    }
    let target = calendarById(journal.calendars[source.id]);
    if (!target || target.accountId !== targetAccountId || target.readOnly) {
      const taken = new Set(Object.values(journal.calendars));
      target =
        adoptable(source, targetAccountId, taken) ??
        (await store().createCalendar(targetAccountId, {
          name: source.name,
          color: source.color,
          components: source.components,
          description: source.description,
          visible: source.visible,
          order: source.order,
        }));
      journal.calendars[source.id] = target.id;
      writeJournal(journal);
    }
    if (target.visible !== source.visible || target.order !== source.order) {
      await store().updateCalendar(target.id, { visible: source.visible, order: source.order });
    }

    const pending = pendingItems(source, target, copiedFrom(source.id));
    // Written down before the copy: what ends up in the target is exactly this.
    for (const item of pending.items) copiedFrom(source.id)[fingerprint(item.uid)] = fingerprint(item.data);
    writeJournal(journal);
    const base = done;
    const copied = await store().importObjects(target.id, pending.items, {
      signal: options.signal,
      onProgress: (n) => {
        done = base + n;
        report('copy', index, source);
      },
    });
    done = base + pending.items.length;
    results.set(source.id, {
      sourceId: source.id,
      targetId: target.id,
      name: source.name,
      copied,
      present: pending.present,
      unreadable: pending.unreadable,
      verified: false,
      deleted: false,
    });
  }

  // A calendar's own default notifications go with it, copied or moved,
  // unless the calendar it went to has its own.
  carryCalendarAlarms([...results.values()].filter((r) => r.targetId).map((r) => [r.sourceId, r.targetId]));

  // Verified against what the accounts list after a full sync, not against
  // what the writes answered: a server may have dropped an item, and the
  // source may have gained or changed one while we were copying.
  checkAborted();
  report('verify', count);
  await syncCompletely(targetAccountId, true);
  if (deleteSource) await syncCompletely(sourceAccountId, true);
  for (const result of results.values()) {
    const source = calendarById(result.sourceId);
    const target = calendarById(result.targetId);
    if (!source || !target || result.kept) continue;
    const left = pendingItems(source, target, copiedFrom(source.id));
    result.unreadable = left.unreadable;
    result.verified = left.items.length === 0;
  }

  if (deleteSource) {
    // New events and tasks follow the data when it moves. A copy leaves the
    // user working where they were.
    const settings = useSettings.getState();
    const moved = (id: string | undefined) => (id && results.has(id) ? results.get(id)!.targetId : undefined);
    const defaults = { defaultCalendarId: moved(settings.defaultCalendarId), defaultTaskListId: moved(settings.defaultTaskListId) };
    if (defaults.defaultCalendarId || defaults.defaultTaskListId) {
      settings.update({
        ...(defaults.defaultCalendarId ? { defaultCalendarId: defaults.defaultCalendarId } : {}),
        ...(defaults.defaultTaskListId ? { defaultTaskListId: defaults.defaultTaskListId } : {}),
      });
    }

    for (const [index, result] of [...results.values()].entries()) {
      checkAborted();
      const source = calendarById(result.sourceId);
      // Kept already: decided while copying.
      if (!source || result.kept) continue;
      if (keptReadOnly(source)) result.kept = 'read-only';
      else if (!result.verified) result.kept = 'unverified';
      else if (result.unreadable) result.kept = 'unreadable';
      else {
        report('delete', index, source);
        try {
          await store().deleteCalendar(source.id);
          result.deleted = true;
        } catch (err) {
          result.kept = 'failed';
          result.error = err instanceof Error ? err.message : String(err);
        }
      }
    }
  }

  const calendars = [...results.values()];
  const complete = calendars.every((c) => c.verified && c.kept !== 'failed');
  if (complete) writeJournal(null);
  report('done', count);
  return {
    calendars,
    generated: plan.generated,
    copied: calendars.reduce((sum, c) => sum + c.copied, 0),
    present: calendars.reduce((sum, c) => sum + c.present, 0),
    unreadable: calendars.reduce((sum, c) => sum + c.unreadable, 0),
    complete,
    sourceEmpty: ownCalendars(sourceAccountId).length === 0,
  };
}
