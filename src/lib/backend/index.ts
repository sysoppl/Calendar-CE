// One backend per account kind: local and CalDAV. `registerBackend` puts
// another in a kind's place (the tests' in-memory server, say).
import { t } from '@/i18n';
import type { Account } from '@/store/data';
import { CalDavBackend } from './caldav';
import { LocalBackend } from './local';
import { BackendError, type AccountKind, type BackendFactory, type CalendarBackend } from './types';

export * from './types';
export { objectFileName } from './names';

const local = new LocalBackend();

const factories = new Map<AccountKind, BackendFactory>([
  ['local', () => local],
  ['caldav', (account) => new CalDavBackend(account)],
]);

/**
 * Makes `factory` the source of backends for accounts of this kind. It is
 * called for every operation, so it should be cheap: hand out one instance
 * and keep caches there. A factory throws `BackendError('locked')` when the
 * account cannot be used right now (its password cannot be read).
 */
export function registerBackend(kind: AccountKind, factory: BackendFactory): void {
  factories.set(kind, factory);
}

export function backendFor(account: Account): CalendarBackend {
  const factory = factories.get(account.kind);
  // An account of a kind with no backend here cannot be used.
  if (!factory) throw new BackendError('locked', t('data.locked'));
  return factory(account);
}
