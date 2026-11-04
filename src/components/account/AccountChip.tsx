import { useState, type ReactNode } from 'react';
import { RefreshCw, Settings } from 'lucide-react';
import { errorMessage, useUi } from '@/store/ui';
import { useData, type Account } from '@/store/data';
import { useT } from '@/i18n';
import { refreshNow } from '@/lib/autoSync';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { AccountPasswordDialog } from '@/components/settings/AccountPasswordDialog';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Menu';
import { TOUCH_AREA } from '@/components/ui/touch';
import { KIND_ICON, useAccountSummary, type AccountState, type AccountSummary } from './shared';

/** States that ask the user to do something, or say that something did not work. */
export const ATTENTION: readonly AccountState[] = ['password', 'unreachable', 'error'];
const DOT: Partial<Record<AccountState, string>> = {
  error: 'bg-danger',
  unreachable: 'bg-danger',
  password: 'bg-warning',
};

type Action = 'password';

/** The one thing to do about a state, if there is one. */
function actionFor(state: AccountState): Action | null {
  return state === 'password' ? 'password' : null;
}

/** Failures that asking again may mend: the "Try again" of the status line. */
const RETRY: readonly AccountState[] = ['unreachable', 'error'];

function useActionLabel() {
  const t = useT();
  return (_action: Action) => t('account.password.reenter');
}

/** The dialogs a chip can open, mounted where the chip lives. */
function ActionDialogs({ action, account, onClose }: { action: Action | null; account?: Account; onClose: () => void }) {
  if (action === 'password' && account) return <AccountPasswordDialog account={account} onClose={onClose} onSaved={onClose} />;
  return null;
}

/** Brings everything up to date now; a failure is said in a toast (the status line says it too). */
export function useRetry(): { retry: () => void; busy: boolean } {
  const t = useT();
  const busy = useData((s) => Object.values(s.syncing).some(Boolean));
  const retry = () => void refreshNow().catch((err) => useUi.getState().toast(t('status.refreshFailed', { error: errorMessage(err) }), 'error'));
  return { retry, busy };
}

/** The kind's icon, with a dot for a state that needs attention. */
function ChipFace({ summary, size, tone }: { summary: AccountSummary; size: number; tone: 'frame' | 'content' }) {
  const Icon = KIND_ICON[summary.kind];
  const dot = DOT[summary.state];
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`flex items-center justify-center rounded-full ${tone === 'frame' ? 'bg-frame-active text-frame-text' : 'bg-primary-weak text-primary'}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Icon size={Math.round(size * 0.5)} />
      </span>
      {dot && (
        <span
          aria-hidden
          data-dot
          className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ${dot} ${tone === 'frame' ? 'ring-[var(--frame-bg)]' : 'ring-[var(--bg-elevated)]'}`}
        />
      )}
    </span>
  );
}

/**
 * Bottom of the sidebar: who and where, the state of the calendars in one
 * calm line, and the way into "Account & storage". A state that needs
 * something done is said here and marked on the icon; the bar over the
 * calendar carries its button.
 */
export function SidebarAccount() {
  const t = useT();
  const mobile = useIsMobile();
  const summary = useAccountSummary();
  const attention = ATTENTION.includes(summary.state);
  // "On this device" needs no second line saying where it is,
  const kind = summary.state === 'device' ? null : summary.kindLabel;
  // nor a state that only says it again.
  const stateText = summary.stateText === summary.title ? null : summary.stateText;

  return (
    <div className={`border-frame-border border-t py-2 pr-3 pl-2.5 ${TOUCH_AREA}`}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => useUi.getState().openSettings('account')}
          title={summary.errorDetail}
          aria-label={`${[summary.title, kind, stateText].filter(Boolean).join('. ')}. ${t('storage.chip.open')}`}
          className="hover:bg-frame-hover flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
        >
          <ChipFace summary={summary} size={32} tone="frame" />
          {/* One thing per line. The state may take up to three, balanced, so no word is left alone. */}
          <span className="min-w-0 flex-1 text-xs leading-tight">
            <span className="block truncate text-[0.8125rem] font-semibold">{summary.title}</span>
            {kind && <span className="text-frame-weak block truncate">{kind}</span>}
            {stateText && (
              <span data-status={summary.state} className={`line-clamp-3 text-balance ${attention ? 'text-frame-text font-medium' : 'text-frame-weak'}`}>
                {stateText}
              </span>
            )}
          </span>
        </button>
        {/* Phones have no settings button in the header, so the drawer carries one. */}
        {mobile && (
          <button
            type="button"
            aria-label={t('nav.settings')}
            title={t('nav.settings')}
            className="text-frame-weak hover:bg-frame-hover pointer-coarse:size-11 flex items-center justify-center rounded-md p-1.5"
            onClick={() => useUi.getState().openSettings('general', { list: true })}
          >
            <Settings size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The account in the header: a round face opening a small card with who and
 * where, the state and what to do about it. On phones it shows only when
 * something needs attention; the drawer carries it otherwise.
 */
export function HeaderAccount() {
  const t = useT();
  const mobile = useIsMobile();
  const summary = useAccountSummary();
  const actionLabel = useActionLabel();
  const { retry, busy } = useRetry();
  const [open, setOpen] = useState<{ action: Action; account?: Account } | null>(null);
  const action = actionFor(summary.state);
  // Only the face hides. A dialog it opened stays while the state moves.
  const shown = !mobile || ATTENTION.includes(summary.state);

  return (
    <>
      {shown && (
        <Popover
          placement="bottom-end"
          trigger={
            <button
              type="button"
              aria-label={`${t('storage.chip.label')}: ${summary.title}, ${summary.stateText}`}
              title={summary.title}
              className="hover:bg-frame-hover flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            >
              <ChipFace summary={summary} size={28} tone="frame" />
            </button>
          }
        >
          {(close) => (
            <div className="w-[min(18rem,calc(100vw-1.5rem))] p-4">
              <div className="flex items-center gap-3">
                <ChipFace summary={summary} size={40} tone="content" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{summary.title}</p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
                <Row label={t('storage.chip.storage')}>{summary.kindLabel}</Row>
                <Row label={t('status.label')}>
                  <span className={ATTENTION.includes(summary.state) ? 'text-text font-medium' : ''} title={summary.errorDetail}>
                    {summary.stateText}
                  </span>
                </Row>
              </dl>
              <div className="mt-4 flex flex-col gap-2">
                {action && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      close();
                      setOpen({ action, account: summary.stateAccount });
                    }}
                  >
                    {actionLabel(action)}
                  </Button>
                )}
                {/* Only after a failure: the app keeps everything up to date by itself. */}
                {RETRY.includes(summary.state) && (
                  <Button icon={<RefreshCw size={16} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} />} disabled={busy} onClick={retry}>
                    {t('status.retry')}
                  </Button>
                )}
                <Button
                  onClick={() => {
                    close();
                    useUi.getState().openSettings('account');
                  }}
                >
                  {t('storage.chip.open')}
                </Button>
              </div>
            </div>
          )}
        </Popover>
      )}
      <ActionDialogs action={open?.action ?? null} account={open?.account} onClose={() => setOpen(null)} />
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-weak">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
