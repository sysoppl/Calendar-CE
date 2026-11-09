// Saving a file the app made (a backup, an .ics export). A browser downloads
// it; the Android app has no downloads, so the system's file picker asks where
// to put it and the native side writes it there (android/…/FilesPlugin.java).
import { registerPlugin } from '@capacitor/core';
import { downloadText } from './importExport';
import { isAndroid } from './platform';

/** `downloaded`: handed to the browser, which may still ask where; nothing more is known. */
export type SaveOutcome = 'saved' | 'cancelled' | 'failed' | 'downloaded';

/** The kinds of file the native side writes; it takes nothing else. */
export type SavedFileType = 'application/json' | 'text/calendar' | 'text/plain';

interface FilesPlugin {
  saveText(options: { name: string; text: string; mimeType: SavedFileType }): Promise<{ result: 'saved' | 'cancelled' | 'failed' }>;
}

const Files = registerPlugin<FilesPlugin>('Files');

/** Saves `text` as a file named `name`: through the picker in the Android app, as a download elsewhere. */
export async function saveTextFile(name: string, text: string, mimeType: SavedFileType): Promise<SaveOutcome> {
  if (isAndroid) {
    try {
      return (await Files.saveText({ name, text, mimeType })).result;
    } catch (err) {
      console.warn('Saving the file failed', err instanceof Error ? err.name : 'error');
      return 'failed';
    }
  }
  downloadText(name, text, mimeType);
  return 'downloaded';
}

/** A name for a file from a calendar's or an event's title: letters, digits, spaces and dashes, never empty. */
export function fileNameFrom(title: string, fallback: string, max = 60): string {
  return title.replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().slice(0, max).trim() || fallback;
}
