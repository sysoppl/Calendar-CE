import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUi, errorMessage } from '@/store/ui';
import { useData, type Account } from '@/store/data';
import { useT, type MessageKey } from '@/i18n';
import { isNative } from '@/lib/platform';
import { Alert } from '@/components/ui/Alert';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Toggle } from '@/components/ui/Controls';
import { PasswordField } from '@/components/ui/PasswordField';
import { sendsInClear } from '@/lib/dav/transport';

interface Provider {
  id: string;
  name: string;
  url: string;
  hint?: MessageKey;
}

/** Common providers with their CalDAV entry points. */
const PROVIDERS: Provider[] = [
  { id: 'custom', name: '', url: '' },
  { id: 'nextcloud', name: 'Nextcloud', url: 'https://cloud.example.com/remote.php/dav', hint: 'welcome.caldav.hint.nextcloud' },
  { id: 'radicale', name: 'Radicale', url: 'http://localhost:5232/' },
  { id: 'baikal', name: 'Baïkal', url: 'https://dav.example.com/dav.php' },
  { id: 'fastmail', name: 'Fastmail', url: 'https://caldav.fastmail.com/', hint: 'welcome.caldav.hint.fastmail' },
  { id: 'icloud', name: 'iCloud', url: 'https://caldav.icloud.com/', hint: 'welcome.caldav.hint.icloud' },
  { id: 'mailbox', name: 'mailbox.org', url: 'https://dav.mailbox.org/' },
  { id: 'posteo', name: 'Posteo', url: 'https://posteo.de:8443/' },
  { id: 'zoho', name: 'Zoho', url: 'https://calendar.zoho.com/caldav/' },
  { id: 'yandex', name: 'Yandex', url: 'https://caldav.yandex.ru/' },
  { id: 'synology', name: 'Synology Calendar', url: 'https://nas.example.com:5001/caldav/' },
];

export function AccountDialog() {
  const open = useUi((s) => s.accountDialog);
  if (!open) return null;
  return <AccountForm />;
}

function AccountForm() {
  const t = useT();
  const close = () => useUi.getState().openAccountDialog(false);
  return (
    <CalDavForm
      onConnected={() => {
        useUi.getState().toast(t('toast.accountAdded'), 'success');
        close();
      }}
    >
      {({ fields, busy, canSubmit, formId }) => (
        <Modal
          open
          onClose={close}
          size="md"
          fullscreenOnMobile
          title={t('account.title')}
          initialFocus="#acc-server"
          footer={
            <>
              <Button onClick={close}>{t('settings.cancel')}</Button>
              <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!canSubmit}>
                {busy ? t('account.connecting') : t('account.connect')}
              </Button>
            </>
          }
        >
          {fields}
        </Modal>
      )}
    </CalDavForm>
  );
}

/** What `CalDavForm` hands to the frame it is shown in. */
export interface CalDavFormParts {
  /** The form itself, fields and error included. Enter in any field connects. */
  fields: ReactNode;
  /** Id of the form, for a submit button placed outside it (`form={formId}`). */
  formId: string;
  busy: boolean;
  /** Server and user name are filled in. */
  canSubmit: boolean;
}

/**
 * The CalDAV connection form without a frame: the Add account dialog puts it
 * in a Modal, the welcome screen on a page. `onConnected` runs once the
 * account is added and its first sync went through.
 */
export function CalDavForm({ onConnected, children }: { onConnected: (account: Account) => void; children: (parts: CalDavFormParts) => ReactNode }) {
  const t = useT();
  const formId = 'acc-form';
  const [provider, setProvider] = useState('custom');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  // Not used in the Android app, which reaches servers itself.
  const [useProxy, setUseProxy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failure = useRef<HTMLDivElement>(null);
  // Plain http to a host on the internet: the address the user confirmed connecting to anyway.
  const [clearConfirmed, setClearConfirmed] = useState<string | null>(null);
  const providerInfo = PROVIDERS.find((p) => p.id === provider);
  const inClear = sendsInClear(serverUrl);
  // In the browser through the app's server, which relays plain http to the
  // internet only where its operator allows it: nothing to confirm here, the
  // form says so, and the server's answer decides.
  const viaProxy = !isNative && useProxy;
  const canSubmit = !!serverUrl && !!username && (!inClear || viaProxy || clearConfirmed === serverUrl);

  // The error is shown under the whole form, off screen on a phone, and the
  // Connect button that had the focus was disabled meanwhile: both go to it.
  useEffect(() => {
    if (!error) return;
    failure.current?.scrollIntoView({ block: 'center' });
    failure.current?.focus({ preventScroll: true });
  }, [error]);

  const submit = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const account = await useData.getState().addCalDavAccount({ serverUrl, username, password, name, useProxy });
      onConnected(account);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const fields = (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="pb-2"
    >
      <Field label={t('account.provider')} htmlFor="acc-provider">
        <select
          id="acc-provider"
          className="field"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            const p = PROVIDERS.find((x) => x.id === e.target.value);
            if (p?.url) setServerUrl(p.url);
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === 'custom' ? t('account.provider.custom') : p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('account.server')} hint={providerInfo?.hint ? t(providerInfo.hint) : t('account.serverHint')} htmlFor="acc-server">
        <input id="acc-server" className="field" type="url" inputMode="url" autoComplete="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://dav.example.com/" required />
      </Field>
      {inClear && (
        <Alert tone="warning" className="mb-4" title={t('account.clear.title')}>
          {viaProxy ? (
            <p>{t('account.clear.proxy')}</p>
          ) : (
            <>
              <p>{t('account.clear.body')}</p>
              <label className="mt-2 flex cursor-pointer items-center gap-2 font-medium">
                <input type="checkbox" checked={clearConfirmed === serverUrl} onChange={(e) => setClearConfirmed(e.target.checked ? serverUrl : null)} />
                {t('account.clear.confirm')}
              </label>
            </>
          )}
        </Alert>
      )}
      {/* A CalDAV server's fields, not a login to this site: a password manager must not offer them for it. */}
      <Field label={t('account.username')} htmlFor="acc-user">
        <input id="acc-user" className="field" name="caldav-user" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
      </Field>
      <PasswordField id="acc-pass" name="caldav-password" autoComplete="new-password" label={t('account.password')} hint={t('account.passwordHint')} value={password} onChange={setPassword} />
      <Field label={t('account.name')} htmlFor="acc-name">
        <input id="acc-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {!isNative && (
        <label className="bg-bg-weak flex cursor-pointer items-start gap-3 rounded-xl p-3">
          <Toggle checked={useProxy} onChange={setUseProxy} label={t('account.useProxy')} />
          <span>
            <span className="block font-semibold">{t('account.useProxy')}</span>
            <span className="text-text-weak text-xs">{t('account.useProxyHint')}</span>
          </span>
        </label>
      )}
      {/* A sentence in the user's language first; the server's own message (often English) after it. */}
      {error && (
        <Alert ref={failure} tabIndex={-1} tone="danger" className="mt-4" title={t('welcome.caldav.failed')}>
          {error}
        </Alert>
      )}
      <button type="submit" hidden />
    </form>
  );

  return children({ fields, formId, busy, canSubmit });
}
