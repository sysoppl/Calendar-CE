import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useUi, errorMessage } from '@/store/ui';
import { useData } from '@/store/data';
import { useT } from '@/i18n';
import { isNative } from '@/lib/platform';
import { randomCalendarColor } from '@/theme/themes';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Controls';
import { ColorPicker } from '@/components/ui/ColorPicker';

export function SubscriptionDialog() {
  const open = useUi((s) => s.subscriptionDialog);
  if (!open) return null;
  return <SubscriptionForm />;
}

function SubscriptionForm() {
  const t = useT();
  const close = () => useUi.getState().openSubscriptionDialog(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(randomCalendarColor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const fallbackName = (() => {
        try {
          return new URL(url.replace(/^webcal/i, 'https')).hostname;
        } catch {
          return url;
        }
      })();
      await useData.getState().addSubscription({ url, name: name.trim() || fallbackName, color });
      useUi.getState().toast(t('subscription.added'), 'success');
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      size="md"
      title={t('subscription.title')}
      initialFocus="#sub-url"
      footer={
        <>
          <Button onClick={close}>{t('settings.cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!url.trim()} onClick={() => void submit()}>
            {t('subscription.subscribe')}
          </Button>
        </>
      }
    >
      <form
        className="pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('subscription.url')} hint={isNative ? t('subscription.urlHint') : `${t('subscription.urlHint')} ${t('subscription.proxyHint')}`} htmlFor="sub-url">
          <input id="sub-url" className="field" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal://example.com/holidays.ics" required />
        </Field>
        <Field label={t('settings.calendarName')} htmlFor="sub-name">
          <input id="sub-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('settings.calendarColor')}>
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        {error && (
          <div role="alert" className="bg-danger/10 text-danger flex items-start gap-2 rounded-xl p-3 text-[0.8125rem]">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
