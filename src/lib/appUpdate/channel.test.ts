import { describe, expect, it } from 'vitest';
import { updateChannel } from './channel';

describe('the update channel', () => {
  const facts = { native: false, platform: 'web', versionUrl: '', downloadUrl: '' };
  const android = { ...facts, native: true, platform: 'android' };
  const server = { versionUrl: 'https://calendar.example.com/version.json', downloadUrl: 'https://calendar.example.com/calendar.apk' };

  it("is the browser's own server, whatever the build was told for Android", () => {
    expect(updateChannel(facts)).toBe('web');
    expect(updateChannel({ ...facts, ...server })).toBe('web');
  });

  it('is nothing for the Android app built without a server, the default', () => {
    expect(updateChannel(android)).toBe('none');
  });

  it("is the server the Android app was built for, only with a download to offer", () => {
    expect(updateChannel({ ...android, ...server })).toBe('android');
    expect(updateChannel({ ...android, versionUrl: server.versionUrl })).toBe('none');
    expect(updateChannel({ ...android, downloadUrl: server.downloadUrl })).toBe('none');
  });

  it('is nothing in the iOS shell or an unknown one', () => {
    expect(updateChannel({ ...facts, ...server, native: true, platform: 'ios' })).toBe('none');
    expect(updateChannel({ ...facts, ...server, native: true, platform: 'electron' })).toBe('none');
  });
});
