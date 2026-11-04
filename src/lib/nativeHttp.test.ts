import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/store/settings';
import { nativeTransport } from './nativeHttp';

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ request: async () => Promise.reject(new Error('timeout')) }),
}));

afterEach(() => {
  useSettings.getState().update({ language: 'en' });
});

describe('nativeTransport', () => {
  it('says in the user\'s language that the server could not be reached', async () => {
    useSettings.getState().update({ language: 'pl' });
    await expect(nativeTransport({ method: 'PROPFIND', url: 'https://dav.example.com/cal/' })).rejects.toThrow('Nie udało się połączyć z dav.example.com (timeout).');
  });
});
