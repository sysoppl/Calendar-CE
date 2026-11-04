// The first start: the welcome screen and whichever way of keeping the
// calendar is chosen on it. Nothing of the app proper (sync, reminders,
// shortcuts) runs while this is on screen; it ends with `setOnboarded`.
import { useEffect, useState } from 'react';
import { Server } from 'lucide-react';
import { useT } from '@/i18n';
import { askOnFirstRun } from '@/lib/notificationAccess';
import { useApp, type StorageMode } from '@/store/app';
import { fillDefaultCalendars, useData } from '@/store/data';
import { errorMessage, useUi } from '@/store/ui';
import { CalDavForm } from '@/components/settings/AccountDialog';
import { Button } from '@/components/ui/Button';
import { BACK_DEPTH, useBackButtonLayer } from './back';
import { OnboardingFrame, StepCard } from './OnboardingFrame';
import { Welcome } from './Welcome';

type Step = 'welcome' | 'caldav';

/**
 * Ends the welcome screen with `mode` as where calendars are kept, naming the
 * calendar and task list new items go to (`fillDefaultCalendars`): the first
 * ones of that place, which Settings then shows instead of "—".
 */
function finish(mode: StorageMode) {
  useApp.getState().setOnboarded(mode);
  fillDefaultCalendars();
}

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const [busy, setBusy] = useState<StorageMode | null>(null);
  const back = () => setStep('welcome');

  // The phone app asks for the notification permission on the first screen of a new install.
  useEffect(() => {
    void askOnFirstRun();
  }, []);

  useBackButtonLayer(BACK_DEPTH.onboarding, () => {
    if (step === 'welcome') return false;
    back();
    return true;
  });

  const choose = async (mode: StorageMode) => {
    if (mode === 'caldav') return setStep('caldav');
    setBusy(mode);
    try {
      await useData.getState().setupLocalDefaults();
      finish('local');
    } catch (err) {
      useUi.getState().toast(errorMessage(err), 'error');
      setBusy(null);
    }
  };

  if (step === 'caldav') return <CalDavStep onBack={back} />;
  return (
    <OnboardingFrame brand={false} wide>
      <Welcome busy={busy} onChoose={(mode) => void choose(mode)} />
    </OnboardingFrame>
  );
}

function CalDavStep({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <CalDavForm
      onConnected={() => {
        useUi.getState().toast(t('toast.accountAdded'), 'success');
        finish('caldav');
      }}
    >
      {({ fields, formId, busy, canSubmit }) => (
        <OnboardingFrame onBack={onBack} backDisabled={busy}>
          <StepCard
            icon={<Server size={22} />}
            title={t('welcome.caldav.formTitle')}
            intro={t('welcome.caldav.formIntro')}
            actions={
              <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!canSubmit}>
                {busy ? t('account.connecting') : t('account.connect')}
              </Button>
            }
          >
            {fields}
          </StepCard>
        </OnboardingFrame>
      )}
    </CalDavForm>
  );
}
