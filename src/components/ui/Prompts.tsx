import { useState } from 'react';
import { useUi, type ConfirmPrompt } from '@/store/ui';
import { useT } from '@/i18n';
import type { EditScope } from '@/lib/ical/types';
import { Modal } from './Modal';
import { Button } from './Button';

/** "This event / this and future / all events" dialog. */
export function ScopeDialog() {
  const prompt = useUi((s) => s.scopePrompt);
  // Mounted per prompt so the choice always starts at "this event".
  return prompt ? <ScopeForm prompt={prompt} /> : null;
}

function ScopeForm({ prompt }: { prompt: NonNullable<ReturnType<typeof useUi.getState>['scopePrompt']> }) {
  const t = useT();
  const [scope, setScope] = useState<EditScope>('single');
  const options: EditScope[] = prompt.allowFuture ? ['single', 'future', 'all'] : ['single', 'all'];
  return (
    <Modal
      open
      size="sm"
      onClose={() => prompt.resolve(null)}
      title={prompt.kind === 'edit' ? t('scope.editTitle') : t('scope.deleteTitle')}
      footer={
        <>
          <Button onClick={() => prompt.resolve(null)}>{t('confirm.cancel')}</Button>
          <Button variant={prompt.kind === 'delete' ? 'danger' : 'primary'} onClick={() => prompt.resolve(scope)}>
            {prompt.kind === 'delete' ? t('confirm.delete') : t('scope.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1 pb-1">
        {options.map((o) => (
          <label key={o} className="hover:bg-bg-weak flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5">
            <input
              type="radio"
              name="scope"
              checked={scope === o}
              onChange={() => setScope(o)}
              className="accent-[var(--primary)] h-4 w-4"
            />
            <span>{t(`scope.${o}`)}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

// The store shows one confirmation at a time, so a second confirm() while one
// is open would replace it and leave the first caller waiting for ever. Asked
// through this version, they line up and are answered one after another.
const waiting: ConfirmPrompt[] = [];
/** Tells one prompt from the next, so each gets a dialog of its own. */
const order = new WeakMap<ConfirmPrompt, number>();
let asked = 0;

useUi.setState({
  confirm: (p) =>
    new Promise<boolean>((resolve) => {
      const prompt: ConfirmPrompt = {
        ...p,
        resolve: (ok) => {
          const at = waiting.indexOf(prompt);
          // Answered already, e.g. by the second click of a double click.
          if (at < 0) return;
          waiting.splice(at, 1);
          useUi.setState({ confirmPrompt: waiting[0] ?? null });
          resolve(ok);
        },
      };
      order.set(prompt, ++asked);
      waiting.push(prompt);
      if (waiting.length === 1) useUi.setState({ confirmPrompt: prompt });
    }),
});

export function ConfirmDialog() {
  const prompt = useUi((s) => s.confirmPrompt);
  // Mounted per prompt: the next one in line opens afresh, with the focus on
  // its own default button instead of wherever the last click landed.
  return prompt ? <ConfirmForm key={order.get(prompt)} prompt={prompt} /> : null;
}

function ConfirmForm({ prompt }: { prompt: ConfirmPrompt }) {
  const t = useT();
  return (
    <Modal
      open
      size="sm"
      onClose={() => prompt.resolve(false)}
      title={prompt.title}
      footer={
        <>
          {/* Enter in a dialog that has just opened must not destroy anything, so a dangerous prompt starts on Cancel. */}
          <Button onClick={() => prompt.resolve(false)} autoFocus={!!prompt.danger}>
            {t('confirm.cancel')}
          </Button>
          <Button variant={prompt.danger ? 'danger' : 'primary'} onClick={() => prompt.resolve(true)} autoFocus={!prompt.danger}>
            {prompt.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-text-weak pb-1">{prompt.message}</p>
    </Modal>
  );
}
