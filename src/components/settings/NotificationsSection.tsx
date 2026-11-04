import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Bell, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useT } from '@/i18n';
import { useFormat } from '@/hooks/useFormat';
import { isNative } from '@/lib/platform';
import { NativeReminders, type ReminderStatus } from '@/lib/nativeReminders';
import { notificationPermission, requestNotificationPermission, rescheduleReminders, showTestNotification, type PermissionState } from '@/lib/reminders';
import { allowNotifications, checkNotificationAccess } from '@/lib/notificationAccess';
import { changeSettings } from '@/lib/saveFeedback';
import { Button } from '@/components/ui/Button';
import { ToggleRow } from '@/components/ui/Controls';

type Level = 'ok' | 'warn' | 'error';

function StatusRow({ level, label, detail, action }: { level: Level; label: string; detail?: ReactNode; action?: ReactNode }) {
  const icon =
    level === 'ok' ? <CheckCircle2 size={20} className="text-success" /> : level === 'warn' ? <AlertTriangle size={20} className="text-warning" /> : <XCircle size={20} className="text-danger" />;
  return (
    // On a phone the button goes under the text, which keeps the whole width.
    <li className="border-border-weak flex flex-wrap items-center gap-x-3 gap-y-2 border-b py-3 last:border-b-0">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{label}</div>
        {detail && <div className="text-text-weak text-[0.8125rem] leading-snug break-words whitespace-pre-wrap">{detail}</div>}
      </div>
      {action && <div className="basis-full pl-8 sm:basis-auto sm:pl-0">{action}</div>}
    </li>
  );
}

/** Android: shows every condition reminders depend on, with a fix for each. */
function NativeHealth() {
  const t = useT();
  const fmt = useFormat();
  const [status, setStatus] = useState<ReminderStatus | null>(null);

  const refresh = useCallback(() => {
    NativeReminders.getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
    // The notice above the calendar goes with what is put right here.
    void checkNotificationAccess();
  }, []);

  useEffect(() => {
    refresh();
    // Returning from Android settings: re-check.
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(refresh, 5000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [refresh]);

  if (!status) return null;
  const when = (ms: number) => `${fmt.date(new Date(ms), { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmt.time(new Date(ms))}`;

  return (
    <section className="bg-bg-weak mt-4 rounded-2xl p-4">
      <h3 className="font-semibold">{t('reminders.status')}</h3>
      <p className="text-text-weak mb-2 text-[0.8125rem]">{t('reminders.statusHint')}</p>
      <ul>
        <StatusRow
          level={status.permission === 'granted' && status.systemEnabled ? 'ok' : 'error'}
          label={t('reminders.permission')}
          detail={status.permission === 'granted' && status.systemEnabled ? t('reminders.allowed') : t('reminders.notAllowed')}
          action={
            status.permission === 'granted' && status.systemEnabled ? undefined : status.permission === 'prompt' ? (
              // The system's dialog, or its settings when it shows none (turned down for good).
              <Button size="sm" variant="primary" onClick={() => void allowNotifications().finally(refresh)}>
                {t('reminders.allow')}
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => void NativeReminders.openNotificationSettings()}>
                {t('reminders.openSettings')}
              </Button>
            )
          }
        />
        <StatusRow
          level={status.channelEnabled ? 'ok' : 'error'}
          label={t('reminders.channel')}
          detail={status.channelEnabled ? t('reminders.ok') : t('reminders.channelOff')}
          action={
            !status.channelEnabled && (
              <Button size="sm" variant="primary" onClick={() => void NativeReminders.openNotificationSettings()}>
                {t('reminders.openSettings')}
              </Button>
            )
          }
        />
        <StatusRow
          level={status.exactAlarms ? 'ok' : 'error'}
          label={t('reminders.exact')}
          detail={status.exactAlarms ? t('reminders.ok') : t('reminders.exactOff')}
          action={
            !status.exactAlarms && (
              <Button size="sm" variant="primary" onClick={() => void NativeReminders.openExactAlarmSettings()}>
                {t('reminders.openSettings')}
              </Button>
            )
          }
        />
        <StatusRow
          level={status.ignoringBatteryOptimizations ? 'ok' : 'warn'}
          label={t('reminders.battery')}
          detail={status.ignoringBatteryOptimizations ? t('reminders.batteryOk') : t('reminders.batteryRestricted')}
          action={
            !status.ignoringBatteryOptimizations && (
              <Button size="sm" onClick={() => void NativeReminders.openBatterySettings()}>
                {t('reminders.openSettings')}
              </Button>
            )
          }
        />
        <StatusRow
          level="ok"
          label={t('reminders.scheduled')}
          detail={
            <>
              {t('reminders.scheduledCount', { n: status.upcoming })}
              {status.nextAt && status.nextTitle && (
                <>
                  <br />
                  {t('reminders.next', { title: status.nextTitle, time: when(status.nextAt) })}
                </>
              )}
            </>
          }
        />
        <StatusRow
          level={status.workerLastError ? 'warn' : 'ok'}
          label={t('reminders.background')}
          detail={
            <>
              {t('reminders.backgroundHint')}
              <br />
              {status.workerLastSuccess ? t('reminders.lastRun', { time: fmt.relativeTime(new Date(status.workerLastSuccess)) }) : t('reminders.neverRun')}
              {status.workerLastError && (
                <>
                  <br />
                  <span className="text-danger">{status.workerLastError}</span>
                </>
              )}
            </>
          }
          action={
            <Button
              size="sm"
              icon={<RefreshCw size={14} />}
              onClick={() => {
                void NativeReminders.runBackgroundSync();
                setTimeout(refresh, 4000);
              }}
            >
              {t('reminders.runNow')}
            </Button>
          }
        />
      </ul>
    </section>
  );
}

export function NotificationsSection() {
  const t = useT();
  const s = useSettings();
  const [perm, setPerm] = useState<PermissionState>('prompt');
  useEffect(() => {
    void notificationPermission().then(setPerm);
  }, []);

  return (
    <>
      <ToggleRow
        label={t('settings.notificationsEnabled')}
        hint={t(isNative ? 'settings.notificationsHintAndroid' : 'settings.notificationsHintWeb')}
        checked={s.notificationsEnabled}
        onChange={async (v) => {
          if (v && perm !== 'granted') {
            const p = await requestNotificationPermission();
            setPerm(p);
          }
          changeSettings({ notificationsEnabled: v });
          rescheduleReminders();
        }}
      />
      {!isNative && perm === 'denied' && <p className="text-danger py-2 text-[0.8125rem]">{t('settings.notificationsDenied')}</p>}
      {/* A browser asks only after a tap: reminders were on from the start, the permission never asked for. */}
      {!isNative && perm === 'prompt' && s.notificationsEnabled && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
          <p className="text-text-weak min-w-0 flex-1 text-[0.8125rem]">{t('reminders.notice.ask')}</p>
          <Button size="sm" variant="primary" onClick={() => void allowNotifications().then(setPerm)}>
            {t('reminders.allow')}
          </Button>
        </div>
      )}
      {isNative && s.notificationsEnabled && <NativeHealth />}
      {s.notificationsEnabled && (
        <div className="flex flex-wrap items-center gap-3 pt-4">
          <Button
            icon={<Bell size={16} />}
            onClick={() => {
              void showTestNotification();
              if (isNative) useUi.getState().toast(t('reminders.testHint'), 'info');
            }}
          >
            {t('settings.testNotification')}
          </Button>
        </div>
      )}
    </>
  );
}
