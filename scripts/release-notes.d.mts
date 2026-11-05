/** A version tag as the release workflows take them: vX.Y.Z. */
export const VERSION_TAG: RegExp;
/** The sections of the notes, in their order, and the commit types that go into each. */
export const SECTIONS: { title: string; types: string[] }[];

export interface Commit {
  hash: string;
  title: string;
  body: string;
  /** True for a merge commit (more than one parent). */
  merge: boolean;
}

/** [major, minor, patch] of a version tag, or null. */
export function versionOf(tag: string): [number, number, number] | null;
/** The highest version tag below `tag` among `tags`, or null when there is none. */
export function previousTag(tag: string, tags: string[]): string | null;
/** A commit title read as a Conventional Commit; type null when it is not one. */
export function parseTitle(title: string): { type: string | null; scope: string | null; breaking: boolean; description: string };
/** True for a commit that only sets the version or merges a release. */
export function isVersionCommit(title: string, merge?: boolean): boolean;
/** What a version commit or a release merge says about the release, or ''. */
export function summaryOf(commit: Pick<Commit, 'title' | 'body' | 'merge'>): string;
/** The text under "### X.Y.Z" in a Markdown file's "## Release notes" section, or ''. */
export function releaseNotesSection(markdown: string, version: string): string;
/** A file's relative links ("#section", "docs/X.md") made absolute for the repository at `tag`. */
export function absoluteLinks(markdown: string, where: { repoUrl: string; tag: string; file: string }): string;
/** Markdown with its hard-wrapped lines joined; blocks stay apart. */
export function unwrap(markdown: string): string;
/** The notes in Markdown. `commits` are newest first. */
export function renderNotes(input: { tag: string; previous: string | null; commits: Commit[]; tagBody?: string; written?: string; repoUrl?: string }): string;
/** The commits of `tag` back to `previous` (all of them without one), newest first. */
export function readCommits(tag: string, previous: string | null, cwd?: string): Commit[];
/** The notes of `tag` in the repository at `cwd`; `writtenIn` is a file whose release notes section may have a part for it. */
export function releaseNotes(tag: string, options?: { cwd?: string; repoUrl?: string; writtenIn?: string }): string;
