import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, Trash2, Plus, Pencil, Server, MonitorSmartphone, Lock, AlertCircle, AlertTriangle, Rss, PartyPopper, KeyRound, ChevronRight } from 'lucide-react';
import { useUi, errorMessage } from '@/store/ui';
import { useSettings } from '@/store/settings';
import { useSyncStatus } from '@/store/syncStatus';
import { calendarsFor, isGeneratedCalendar, passwordInMemoryOnly, useData, type Account } from '@/store/data';
import { useT } from '@/i18n';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { normalizeItemColor } from '@/lib/color';
import { sendsInClear } from '@/lib/dav/transport';
import { changeSettings } from '@/lib/saveFeedback';
import { accountStatusEntry, needsPassword, statusText } from '@/components/account/shared';
import { Button, IconButton } from '@/components/ui/Button';
import { SettingRow } from '@/components/ui/Controls';
import { AccountPasswordDialog } from './AccountPasswordDialog';
import { SELECT } from './styles';

/** The account's state in one line, with "Try again" after a failure. */
function AccountStatus({ account }: { account: Account }) {
  const t = useT();
  const online = useSyncStatus((s) => s.online);
  const syncing = useData((s) => !!s.syncing[account.id]);
  const entry = accountStatusEntry(account, { online });
  if (!entry) return null;
  const text = entry.state === 'ok' ? t('status.synced') : statusText(entry, [account], t);
  const failed = entry.state !== 'ok';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span data-status={entry.state} className={`text-xs ${failed ? 'text-text font-medium' : 'text-text-hint'}`}>
        {text}
      </span>
      {/* Only after a failure: the app keeps the account up to date by itself. */}
      {account.error && (
        <Button
          size="sm"
          icon={<RefreshCw size={14} className={syncing ? 'animate-spin motion-reduce:animate-none' : ''} />}
          disabled={syncing}
          onClick={() =>
            void useData
              .getState()
              .syncAccount(account.id)
              .catch((err) => useUi.getState().toast(t('status.refreshFailed', { error: errorMessage(err) }), 'error'))
          }
        >
          {t('status.retry')}
        </Button>
      )}
    </div>
  );
}

export function AccountCard({ account }: { account: Account }) {
  const t = useT();
  const allCalendars = useData((s) => s.calendars);
  const calendars = useMemo(() => allCalendars.filter((c) => c.accountId === account.id).sort((a, b) => a.order - b.order), [allCalendars, account.id]);
  const ui = useUi();
  const heading = useRef<HTMLHeadingElement>(null);
  const [askPassword, setAskPassword] = useState(false);
  // The saved password cannot be read on this device (its key is gone, or did not open this time), or the server refused it.
  const passwordNeeded = needsPassword(account);
  const isLocal = account.kind === 'local';
  const title = isLocal ? t('settings.local') : account.name;
  const detail = isLocal ? t('settings.localHint') : `${account.username} · ${account.homeUrl ? new URL(account.homeUrl).host : account.serverUrl}`;

  const remove = async () => {
    const ok = await ui.confirm({
      title: t('confirm.removeAccountTitle'),
      message: t('confirm.removeAccount', { name: account.name }),
      confirmLabel: t('confirm.remove'),
      danger: true,
    });
    if (!ok) return;
    try {
      await useData.getState().removeAccount(account.id);
      ui.toast(t('save.accountRemoved'), 'success');
    } catch (err) {
      ui.toast(errorMessage(err), 'error');
    }
  };

  return (
    <section className="border-border-weak mb-4 rounded-2xl border" aria-labelledby={`acc-${account.id}`}>
      <header className="flex items-start gap-3 p-4">
        <span className="bg-primary-weak text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full" aria-hidden>
          {isLocal ? <MonitorSmartphone size={20} /> : <Server size={20} />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* The focus comes here when what it was on goes with the problem it was for. */}
          <h4 ref={heading} id={`acc-${account.id}`} tabIndex={-1} className="truncate font-semibold">
            {title}
          </h4>
          {/* Two lines rather than an address cut short. */}
          <div className="text-text-weak line-clamp-2 text-xs break-words">{detail}</div>
          {!isLocal && <AccountStatus account={account} />}
        </div>
        {!isLocal && (
          <IconButton label={t('settings.removeAccount')} onClick={() => void remove()}>
            <Trash2 size={16} />
          </IconButton>
        )}
      </header>
      {(account.error || passwordNeeded) && (
        <div className="bg-danger/10 text-danger mx-4 mb-3 flex items-start gap-2 rounded-lg p-2.5 text-xs">
          <AlertCircle size={14} className="mt-px shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="break-words whitespace-pre-wrap">{account.error || t('account.password.unreadable')}</p>
            {passwordNeeded && (
              <Button size="sm" className="mt-2" icon={<KeyRound size={14} />} onClick={() => setAskPassword(true)}>
                {t('account.password.reenter')}
              </Button>
            )}
          </div>
        </div>
      )}
      {askPassword && (
        <AccountPasswordDialog
          account={account}
          onClose={() => setAskPassword(false)}
          onSaved={() => {
            setAskPassword(false);
            // The button that opened the dialog is gone with the problem it was for.
            requestAnimationFrame(() => heading.current?.focus());
          }}
        />
      )}
      {account.kind === 'caldav' && account.password !== undefined && !account.passwordBox && (
        <div className="bg-warning/10 text-text mx-4 mb-3 flex items-start gap-2 rounded-lg p-2.5 text-xs">
          <Lock size={14} className="text-warning mt-px shrink-0" aria-hidden />
          <span>{t(passwordInMemoryOnly(account.id) ? 'data.passwordNotSaved' : 'data.passwordInClear')}</span>
        </div>
      )}
      {account.kind === 'caldav' && [account.serverUrl, account.principalUrl, account.homeUrl].some(sendsInClear) && (
        <div data-warning="clear" className="bg-warning/10 text-text mx-4 mb-3 flex items-start gap-2 rounded-lg p-2.5 text-xs">
          <AlertTriangle size={14} className="text-warning mt-px shrink-0" aria-hidden />
          <span>{t('account.clear.card')}</span>
        </div>
      )}
      {/* No empty strip under an account that holds no calendars (yet). */}
      {calendars.length > 0 && (
        <ul className="border-border-weak border-t px-2 py-2">
          {calendars.map((c) => (
            <li key={c.id} className="hover:bg-bg-weak flex items-center gap-3 rounded-lg px-2 py-2">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: normalizeItemColor(c.color) }} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-text-hint hidden text-xs sm:inline">
                {c.components.includes('VEVENT') && c.components.includes('VTODO')
                  ? t('settings.calendarType.both')
                  : c.components.includes('VTODO')
                    ? t('settings.calendarType.tasks')
                    : t('settings.calendarType.events')}
              </span>
              {c.readOnly && !isGeneratedCalendar(c) && <Lock size={14} className="text-text-hint" aria-label={t('sidebar.readOnly')} />}
              <IconButton label={t('sidebar.edit')} size={30} onClick={() => ui.openCalendarDialog({ calendarId: c.id, kind: c.components.includes('VEVENT') ? 'events' : 'tasks' })}>
                <Pencil size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * "My email addresses": saved when the field is left (or Enter is pressed),
 * not with every key, which would be a save per pause.
 */
function MyEmailsField() {
  const t = useT();
  const stored = useSettings((s) => s.myEmails);
  const [text, setText] = useState(stored);
  const draft = useRef<string | null>(null);
  // A change from elsewhere shows unless the field is being edited.
  useEffect(() => {
    if (draft.current === null) setText(stored);
  }, [stored]);
  const commit = () => {
    const value = draft.current;
    draft.current = null;
    if (value !== null && value !== useSettings.getState().myEmails) changeSettings({ myEmails: value });
  };
  // Settings closed while typing: what was typed is kept.
  useEffect(() => commit, []);
  return (
    <SettingRow label={t('settings.myEmails')} hint={t('settings.myEmailsHint')} htmlFor="set-emails">
      <input
        id="set-emails"
        className="field"
        type="text"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          draft.current = e.target.value;
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="me@example.com, work@example.com"
      />
    </SettingRow>
  );
}

interface AddAction {
  key: string;
  icon: ReactNode;
  label: string;
  run: () => void;
  primary?: boolean;
}

/** The ways to add calendars and accounts: a row of buttons, or on a phone a list with one full-width row each. */
function AddActions({ actions }: { actions: AddAction[] }) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <ul className="border-border-weak divide-border-weak mt-2 mb-4 divide-y rounded-xl border">
        {actions.map((a) => (
          <li key={a.key}>
            <button
              type="button"
              onClick={a.run}
              className={`hover:bg-bg-weak flex min-h-12 w-full items-center gap-3 px-3 text-left first:rounded-t-xl last:rounded-b-xl ${a.primary ? 'text-primary font-semibold' : ''}`}
            >
              <span className={`shrink-0 ${a.primary ? '' : 'text-text-weak'}`} aria-hidden>
                {a.icon}
              </span>
              <span className="min-w-0 flex-1">{a.label}</span>
              <ChevronRight size={18} className="text-text-hint shrink-0" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap gap-2 pt-2">
      {actions.map((a) => (
        <Button key={a.key} variant={a.primary ? 'primary' : 'outline'} icon={a.icon} onClick={a.run}>
          {a.label}
        </Button>
      ))}
    </div>
  );
}

export function CalendarsSection() {
  const t = useT();
  const accounts = useData((s) => s.accounts);
  const calendars = useData((s) => s.calendars);
  const s = useSettings();
  const ui = useUi();
  const eventCals = calendarsFor('VEVENT', calendars).filter((c) => !c.readOnly);
  const taskCals = calendarsFor('VTODO', calendars).filter((c) => !c.readOnly);

  return (
    <>
      <AddActions
        actions={[
          { key: 'account', icon: <Server size={16} />, label: t('settings.addAccount'), run: () => ui.openAccountDialog(true), primary: true },
          { key: 'calendar', icon: <Plus size={16} />, label: t('settings.newCalendar'), run: () => ui.openCalendarDialog({ kind: 'events' }) },
          { key: 'tasks', icon: <Plus size={16} />, label: t('settings.newTaskList'), run: () => ui.openCalendarDialog({ kind: 'tasks' }) },
          { key: 'holidays', icon: <PartyPopper size={16} />, label: t('sidebar.addHolidays'), run: () => ui.openHolidaysDialog(true) },
          { key: 'feed', icon: <Rss size={16} />, label: t('sidebar.addSubscription'), run: () => ui.openSubscriptionDialog(true) },
        ]}
      />
      <SettingRow label={t('settings.defaultCalendar')} htmlFor="set-defcal">
        <select id="set-defcal" className={SELECT} value={s.defaultCalendarId ?? ''} onChange={(e) => changeSettings({ defaultCalendarId: e.target.value || undefined })}>
          <option value="">—</option>
          {eventCals.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t('settings.defaultTaskList')} htmlFor="set-deflist">
        <select id="set-deflist" className={SELECT} value={s.defaultTaskListId ?? ''} onChange={(e) => changeSettings({ defaultTaskListId: e.target.value || undefined })}>
          <option value="">—</option>
          {taskCals.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </SettingRow>
      <MyEmailsField />
      <h3 className="mt-6 mb-3 font-semibold">{t('settings.accounts')}</h3>
      {accounts.map((a) => (
        <AccountCard key={a.id} account={a} />
      ))}
    </>
  );
}
