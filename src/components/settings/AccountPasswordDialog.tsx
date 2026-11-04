import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { isBackendError } from '@/lib/backend';
import { discoverCalDav } from '@/lib/backend/caldav';
import { useData, type Account } from '@/store/data';
import { errorMessage, useUi } from '@/store/ui';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PasswordField } from '@/components/ui/PasswordField';

const FIELD_ID = 'acc-password-again';

/** Where the account lives, for the sentence that names it. */
function serverOf(account: Account): string {
  try {
    return new URL(account.homeUrl ?? account.serverUrl ?? '').host;
  } catch {
    return account.serverUrl ?? '';
  }
}

/**
 * Asks for a CalDAV account's password again, when the one saved on this
 * device can no longer be read. The server is asked first, the way adding
 * the account does it; only a password it accepts is saved, wrapped like
 * any other. `onSaved` runs once it is, and a sync follows.
 */
export function AccountPasswordDialog({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const formId = 'acc-password-form';
  const field = useRef<HTMLInputElement>(null);
  const failure = useRef<HTMLDivElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Closed while the server was being asked: what it answers no longer matters.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  // A failure that is not about the password is shown under the field: brought into view and read out.
  useEffect(() => {
    if (!error) return;
    failure.current?.scrollIntoView({ block: 'nearest' });
    failure.current?.focus({ preventScroll: true });
  }, [error]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setRejected(false);
    setError(null);
    try {
      await discoverCalDav({ serverUrl: account.serverUrl ?? account.homeUrl ?? '', username: account.username ?? '', password, useProxy: account.useProxy });
      if (!open.current) return;
      // Removed meanwhile: there is nothing left to save it for.
      if (!useData.getState().accounts.some((a) => a.id === account.id)) return onClose();
      await useData.getState().setAccountPassword(account.id, password);
      useUi.getState().toast(t('account.password.saved'), 'success');
      onSaved();
      void useData
        .getState()
        .syncAccount(account.id)
        .catch((err) => useUi.getState().toast(errorMessage(err), 'error'));
    } catch (err) {
      if (!open.current) return;
      if (isBackendError(err, 'auth')) {
        setRejected(true);
        field.current?.focus();
        field.current?.select();
      } else setError(errorMessage(err));
    } finally {
      if (open.current) setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t('account.password.reenter')}
      initialFocus={`#${FIELD_ID}`}
      footer={
        <>
          <Button onClick={onClose}>{t('settings.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {busy ? t('account.password.checking') : t('account.password.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-text-weak mb-4">{t('account.password.intro', { user: account.username ?? '', server: serverOf(account) })}</p>
        {/* A CalDAV server's password: a password manager must not offer another login here. */}
        <PasswordField
          ref={field}
          id={FIELD_ID}
          name="caldav-password"
          autoComplete="new-password"
          label={t('account.password')}
          value={password}
          onChange={(value) => {
            setPassword(value);
            setRejected(false);
          }}
          // Read-only rather than disabled while it is checked, so the focus stays in the field.
          readOnly={busy}
          error={rejected ? t('account.password.rejected') : undefined}
        />
        {error && (
          <Alert ref={failure} tone="danger" tabIndex={-1} className="mb-2" title={t('welcome.caldav.failed')}>
            {error}
          </Alert>
        )}
      </form>
    </Modal>
  );
}
