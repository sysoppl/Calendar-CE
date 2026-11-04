// @vitest-environment jsdom
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackdropDismiss } from './backdrop';

let root: Root;
let close: ReturnType<typeof vi.fn<() => void>>;

function Sheet() {
  const backdrop = useBackdropDismiss(close);
  return h('div', { id: 'backdrop', ...backdrop }, h('div', { id: 'sheet', onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() }, 'Details'));
}

beforeEach(() => {
  close = vi.fn<() => void>();
  root = createRoot(document.body.appendChild(document.createElement('div')));
  flushSync(() => root.render(h(Sheet)));
});

afterEach(() => root.unmount());

const el = (id: string) => document.getElementById(id)!;
const down = (target: Element) => target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
const click = (target: Element) => target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('the backdrop of a sheet', () => {
  it('ignores the click of the tap that opened the sheet (it began elsewhere)', () => {
    click(el('backdrop'));
    expect(close).not.toHaveBeenCalled();
  });

  it('closes the sheet on a tap that began and ended on it', () => {
    down(el('backdrop'));
    click(el('backdrop'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays when a press began inside the sheet and ended on the backdrop', () => {
    down(el('sheet'));
    click(el('backdrop'));
    expect(close).not.toHaveBeenCalled();
  });

  it('counts each press once', () => {
    down(el('backdrop'));
    click(el('backdrop'));
    click(el('backdrop'));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
