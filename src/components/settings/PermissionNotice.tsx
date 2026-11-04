import { BellOff, X } from 'lucide-react';
import { useT, type MessageKey } from '@/i18n';
import { isNative } from '@/lib/platform';
import { fixNotificationAccess, noticeShown, snoozeNotice, useNotificationAccess, type AccessProblem } from '@/lib/notificationAccess';
import { Button, IconButton } from '@/components/ui/Button';
import { TOUCH_HIT } from '@/components/ui/touch';

const TEXT: Record<AccessProblem, MessageKey> = {
  ask: 'reminders.notice.ask',
  denied: 'reminders.blocked',
  channel: 'reminders.notice.channel',
  exact: 'reminders.notice.exact',
};

/**
 * Above the calendar while reminders are on but cannot arrive: the
 * notification permission, Android's reminders channel, exact alarms. Put
 * away, it stays away for a week; Settings › Notifications still shows the
 * problem. It goes as soon as the problem is put right
 * (`startNotificationAccess` looks again when the app comes back in front).
 */
export function PermissionNotice({ className = '' }: { className?: string }) {
  const t = useT();
  const problem = useNotificationAccess((s) => s.problem);
  const snoozedAt = useNotificationAccess((s) => s.snoozedAt);
  const asking = useNotificationAccess((s) => s.asking);
  if (!noticeShown(problem, snoozedAt, asking, Date.now())) return null;
  // A browser that blocks notifications has no settings screen the app can open.
  const webBlocked = !isNative && problem === 'denied';
  const text = t(webBlocked ? 'reminders.notice.webBlocked' : TEXT[problem]);
  return (
    <div
      role="status"
      data-permission-notice={problem}
      // About 40 px tall; a finger gets 44 px around the buttons.
      className={`bg-bg text-text border-border-weak mb-2 flex items-center gap-x-2 rounded-xl border py-1 pr-1 pl-3 text-[0.8125rem] ${className}`}
    >
      <BellOff size={16} className="text-warning shrink-0" aria-hidden />
      {/* Two lines at most on a phone: the button stays. */}
      <span className="line-clamp-2 min-w-0 flex-1 leading-snug" title={text}>
        {text}
      </span>
      {!webBlocked && (
        <Button size="sm" variant="primary" className={TOUCH_HIT} onClick={() => void fixNotificationAccess(problem)}>
          {t(problem === 'ask' ? 'reminders.allow' : 'reminders.openSettings')}
        </Button>
      )}
      <IconButton label={t('banner.dismiss')} size={32} className={TOUCH_HIT} onClick={() => snoozeNotice()}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
