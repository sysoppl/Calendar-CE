import type { Plugin } from 'vite';

/** The file's name in the web bundle. */
export const VERSION_FILE: string;
/** Whether `value` is a version the app reads ("1.16.0"). */
export function isPlainVersion(value: unknown): value is string;
/** The release part of a package version. */
export function releaseOf(appVersion: string): string;
/** The text of version.json for a bundle of `appVersion`. */
export function versionFileText(appVersion: string): string;
/** Writes version.json into the finished build. */
export function versionFile(appVersion: string): Plugin;
