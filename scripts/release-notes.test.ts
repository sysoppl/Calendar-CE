// The release notes the release workflow publishes with every version tag.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { absoluteLinks, isVersionCommit, parseTitle, previousTag, releaseNotes, releaseNotesSection, renderNotes, summaryOf, unwrap, type Commit } from './release-notes.mjs';

const hash = (n: number) => n.toString(16).padStart(40, 'a');
const commit = (n: number, title: string, body = '', merge = false): Commit => ({ hash: hash(n), title, body, merge });

describe('previousTag', () => {
  it('is the highest version tag below the tag, by version and not by text', () => {
    const tags = ['v1.9.0', 'v1.10.0', 'v1.10.2', 'v1.11.0', 'v1.2.0', 'v2.0.0', 'nightly', 'v1.10.1-rc1'];
    expect(previousTag('v1.11.0', tags)).toBe('v1.10.2');
    expect(previousTag('v1.10.0', tags)).toBe('v1.9.0');
    expect(previousTag('v1.10.2', tags)).toBe('v1.10.0');
    expect(previousTag('v3.0.0', tags)).toBe('v2.0.0');
  });

  it('is null for the first release, and refuses what is not a version tag', () => {
    expect(previousTag('v1.0.0', ['v1.0.0', 'v1.1.0'])).toBeNull();
    expect(previousTag('v0.1.0', [])).toBeNull();
    expect(() => previousTag('1.0.0', [])).toThrow(/vX\.Y\.Z/);
    expect(() => previousTag('v1.0', [])).toThrow(/vX\.Y\.Z/);
  });
});

describe('parseTitle', () => {
  it('reads type, scope, breaking mark and description', () => {
    expect(parseTitle('feat(android): pinned notifications')).toEqual({ type: 'feat', scope: 'android', breaking: false, description: 'pinned notifications' });
    expect(parseTitle('fix: keep the day')).toEqual({ type: 'fix', scope: null, breaking: false, description: 'keep the day' });
    expect(parseTitle('feat(api)!: a new format')).toEqual({ type: 'feat', scope: 'api', breaking: true, description: 'a new format' });
    expect(parseTitle('Fix(CI):  the runner ')).toEqual({ type: 'fix', scope: 'CI', breaking: false, description: 'the runner' });
  });

  it('takes any other title as a whole, also one that only looks like a type', () => {
    expect(parseTitle('Update README.md')).toEqual({ type: null, scope: null, breaking: false, description: 'Update README.md' });
    expect(parseTitle('feat:')).toEqual({ type: null, scope: null, breaking: false, description: 'feat:' });
    for (const title of ['Android: fix the crash', 'README: typo', 'WIP: half a feature', 'Note(x): y']) {
      expect(parseTitle(title), title).toEqual({ type: null, scope: null, breaking: false, description: title });
    }
  });
});

describe('version commits', () => {
  it('are the ones that set the version or merge a release', () => {
    for (const title of [
      'chore: release v1.10.1',
      'chore: release 1.11.1',
      'chore: version 1.12.0 - persistent notifications',
      'chore: bump the version to 1.2.3',
      'chore(release): v2.0.0',
      'release: Calendar 2.1.0 - weekly reports',
      'release: v2.1.0',
      'Release v1.2.3',
    ]) {
      expect(isVersionCommit(title), title).toBe(true);
    }
    for (const title of [
      'chore: name the npm package calendar-ce',
      'chore(deps): minimatch 11.0.4 through rimraf 6.1.4',
      'feat: version history of an event',
      'docs: release notes',
      'release: sign the bundle with the new key',
      'chore: release notes in the workflow',
      'Release notes for the importer',
    ]) {
      expect(isVersionCommit(title), title).toBe(false);
    }
    expect(isVersionCommit('merge: Calendar 1.12.0 - persistent notifications', true)).toBe(true);
    expect(isVersionCommit('merge: v2.0.0', true)).toBe(true);
    for (const title of ['merge: the importer reads larger files', 'merge: security/review-1.2.0 into main', 'merge: the sync engine moves to its 2.6.2 protocol']) {
      expect(isVersionCommit(title, true), title).toBe(false);
    }
  });

  it('say what the release is about after the dash, or in their first paragraph', () => {
    expect(summaryOf(commit(1, 'chore: release v1.11.2 - the footer links the Community Edition'))).toBe('The footer links the Community Edition.');
    expect(summaryOf(commit(1, 'chore: release v1.10.1', 'The contact address is now\ncalendar@example.com.\n\nCo-Authored-By: Someone <x@example.com>\n'))).toBe('The contact address is now calendar@example.com.');
    expect(summaryOf(commit(1, 'chore: release v1.10.1', 'Signed-off-by: A <a@example.com>'))).toBe('');
    // A last paragraph that only looks like a trailer is the message's own.
    expect(summaryOf(commit(1, 'chore: release v1.10.1', 'Note: everyone signs in again.'))).toBe('Note: everyone signs in again.');
    expect(summaryOf(commit(1, 'merge: Calendar 1.12.0 - persistent notifications', 'Merge body', true))).toBe('Persistent notifications.');
    expect(summaryOf(commit(1, 'merge: Calendar 1.12.0', 'Merge body', true))).toBe('');
  });
});

describe('releaseNotesSection', () => {
  const readme = [
    '# App',
    '',
    '### 1.2.0',
    '',
    'Not in the release notes section.',
    '',
    '## Release notes',
    '',
    '### 1.2.0',
    '',
    '- **Reminders**: they persist.',
    '  Second line.',
    '',
    '```bash',
    '### 1.1.0 inside a code block',
    '```',
    '',
    '#### Details',
    '',
    'More.',
    '',
    '### v1.1.0',
    '',
    '- Older.',
    '',
    '## Licence',
    '',
    '### 1.0.0',
    '',
    'Not release notes either.',
  ].join('\r\n');

  it('is the part under the version heading of the release notes section, sub-headings and code included', () => {
    expect(releaseNotesSection(readme, '1.2.0')).toBe(
      ['- **Reminders**: they persist.', '  Second line.', '', '```bash', '### 1.1.0 inside a code block', '```', '', '#### Details', '', 'More.'].join('\n'),
    );
    expect(releaseNotesSection(readme, '1.1.0')).toBe('- Older.');
  });

  it('is empty for a version without a part, and outside the section', () => {
    expect(releaseNotesSection(readme, '1.0.0')).toBe('');
    expect(releaseNotesSection(readme, '1.3.0')).toBe('');
    expect(releaseNotesSection('', '1.2.0')).toBe('');
    expect(releaseNotesSection('## Release notes\n\n### 1.2.0\n\nLast part of the file.\n', '1.2.0')).toBe('Last part of the file.');
  });

  it('finds a heading with more after the version, and not a longer version', () => {
    const notes = '## Release notes\n\n### 1.2.10\n\nTen.\n\n### 1.2.1 (5 November 2026)\n\nOne.\n';
    expect(releaseNotesSection(notes, '1.2.1')).toBe('One.');
    expect(releaseNotesSection(notes, '1.2.10')).toBe('Ten.');
    expect(releaseNotesSection(notes, '1.2.0')).toBe('');
  });
});

describe('absoluteLinks', () => {
  const text = 'See [Plans](#plans-for-the-cloud), [the design](docs/DESIGN.md#billing), [this](./CHANGES.md), [a site](https://example.com/x), [mail](mailto:a@example.com) and [root](/x).';

  it('points sections and files into the repository as the tag has it', () => {
    expect(absoluteLinks(text, { repoUrl: 'https://github.com/owner/repo/', tag: 'v1.2.0', file: 'README.md' })).toBe(
      'See [Plans](https://github.com/owner/repo/blob/v1.2.0/README.md#plans-for-the-cloud), [the design](https://github.com/owner/repo/blob/v1.2.0/docs/DESIGN.md#billing), [this](https://github.com/owner/repo/blob/v1.2.0/CHANGES.md), [a site](https://example.com/x), [mail](mailto:a@example.com) and [root](/x).',
    );
    expect(absoluteLinks('[Up](#top) and [next](NEXT.md)', { repoUrl: 'https://git.example.com/owner/repo', tag: 'v1.2.0', file: 'docs/NOTES.md' })).toBe(
      '[Up](https://git.example.com/owner/repo/src/tag/v1.2.0/docs/NOTES.md#top) and [next](https://git.example.com/owner/repo/src/tag/v1.2.0/docs/NEXT.md)',
    );
  });

  it('leaves the text as it is without the repository address', () => {
    expect(absoluteLinks(text, { repoUrl: '', tag: 'v1.2.0', file: 'README.md' })).toBe(text);
  });
});

describe('unwrap', () => {
  it('joins hard-wrapped lines and keeps blocks apart', () => {
    const text = [
      'A paragraph that goes',
      'on and on.',
      '',
      '- **Item**: wrapped',
      '  under its bullet.',
      '  - A sub-item',
      '    wrapped too.',
      '1. Numbered',
      '   and wrapped.',
      '',
      '```bash',
      'npm ci',
      'npm test',
      '```',
      '#### A heading',
      'right below it.',
      '| a | b |',
      '| - | - |',
      '> A quote',
      '',
      'A line that',
      'ends with a break  ',
      'next line.',
    ].join('\r\n');
    expect(unwrap(text)).toBe(
      [
        'A paragraph that goes on and on.',
        '',
        '- **Item**: wrapped under its bullet.',
        '  - A sub-item wrapped too.',
        '1. Numbered and wrapped.',
        '',
        '```bash',
        'npm ci',
        'npm test',
        '```',
        '#### A heading',
        'right below it.',
        '| a | b |',
        '| - | - |',
        '> A quote',
        '',
        'A line that ends with a break  ',
        'next line.',
      ].join('\n'),
    );
  });

  it('keeps rules and heading underlines on lines of their own', () => {
    expect(unwrap('Above\n---\nBelow\nand more\n\nTitle\n=====\n* * *\nEnd')).toBe('Above\n---\nBelow and more\n\nTitle\n=====\n* * *\nEnd');
  });
});

describe('renderNotes', () => {
  const repoUrl = 'https://git.example.com/owner/calendar/';

  it('opens with what was written for the release instead of the version commit', () => {
    const notes = renderNotes({
      tag: 'v1.2.0',
      previous: 'v1.1.0',
      written: '- **Reminders**: they persist.\n',
      commits: [commit(2, 'chore: version 1.2.0 - persistent reminders'), commit(1, 'feat: persistent reminders')],
    });
    expect(notes).toBe(['- **Reminders**: they persist.', '', '### New', '', `- Persistent reminders (${hash(1).slice(0, 7)})`, ''].join('\n'));
    expect(renderNotes({ tag: 'v1.2.1', previous: 'v1.2.0', written: 'A fix for the importer.', commits: [commit(3, 'chore: release v1.2.1')] })).toBe('A fix for the importer.\n');
  });

  it('groups the commits by kind, with links, newest first within a section', () => {
    const notes = renderNotes({
      tag: 'v1.12.0',
      previous: 'v1.11.2',
      repoUrl,
      commits: [
        commit(9, 'merge: Calendar 1.12.0 - persistent notifications for events and tasks', '', true),
        commit(8, 'chore: version 1.12.0 - persistent notifications'),
        commit(7, 'docs: persistent notifications in the README'),
        commit(6, 'feat(android): pinned notifications that come back after a swipe'),
        commit(5, 'fix: keep the day and month while the year is typed'),
        commit(4, 'feat(editor): Persistent notification below the notifications'),
        commit(3, 'ci: pin the checkout action'),
        commit(2, 'Update the icon'),
        commit(1, 'perf: fewer renders of the week view'),
      ],
    });
    const link = (n: number) => `([${hash(n).slice(0, 7)}](https://git.example.com/owner/calendar/commit/${hash(n)}))`;
    expect(notes).toBe(
      [
        'Persistent notifications for events and tasks.',
        '',
        '### New',
        '',
        `- **android:** Pinned notifications that come back after a swipe ${link(6)}`,
        `- **editor:** Persistent notification below the notifications ${link(4)}`,
        '',
        '### Fixes',
        '',
        `- Keep the day and month while the year is typed ${link(5)}`,
        '',
        '### Performance',
        '',
        `- Fewer renders of the week view ${link(1)}`,
        '',
        '### Documentation',
        '',
        `- Persistent notifications in the README ${link(7)}`,
        '',
        '### Maintenance',
        '',
        `- Pin the checkout action ${link(3)}`,
        '',
        '### Other changes',
        '',
        `- Update the icon ${link(2)}`,
        '',
        '**Full changelog:** [v1.11.2...v1.12.0](https://git.example.com/owner/calendar/compare/v1.11.2...v1.12.0)',
        '',
      ].join('\n'),
    );
  });

  it('puts breaking changes first and opens with the tag message', () => {
    const notes = renderNotes({
      tag: 'v2.0.0',
      previous: 'v1.12.0',
      tagBody: 'A new storage format.\n\nOlder apps cannot read it.\n',
      commits: [commit(2, 'feat(store)!: a new format'), commit(1, 'fix: the importer', 'BREAKING CHANGE: old files are refused')],
    });
    expect(notes).toBe(
      ['A new storage format.', '', 'Older apps cannot read it.', '', '### Breaking changes', '', `- **store:** A new format (${hash(2).slice(0, 7)})`, `- The importer (${hash(1).slice(0, 7)})`, ''].join('\n'),
    );
  });

  it('keeps the tag message as written: lists, wrapped lines, a closing note', () => {
    const notes = renderNotes({
      tag: 'v2.0.1',
      previous: 'v2.0.0',
      tagBody: 'Three fixes:\n\n- one\n- two that goes\n  on\n- three\n\nNote: everyone signs in again.\n\nSigned-off-by: A <a@example.com>\n',
      commits: [],
    });
    expect(notes).toBe('Three fixes:\n\n- one\n- two that goes on\n- three\n\nNote: everyone signs in again.\n');
  });

  it('takes titles literally in Markdown', () => {
    const notes = renderNotes({ tag: 'v1.0.1', previous: 'v1.0.0', commits: [commit(1, 'fix(ui): <b>bold</b> *stars* and `ticks` [link](x)')] });
    expect(notes).toContain('- **ui:** \\<b\\>bold\\</b\\> \\*stars\\* and \\`ticks\\` \\[link\\](x) (');
  });

  it('mentions nobody, keeps e-mail addresses and links pull request numbers', () => {
    const notes = renderNotes({
      tag: 'v1.0.1',
      previous: 'v1.0.0',
      commits: [commit(2, 'chore(deps): @capacitor/core 8.1 for @someone_else (#42)'), commit(1, 'fix: mail to calendar@example.com.')],
    });
    expect(notes).toContain('- **deps:** `@capacitor/core` 8.1 for `@someone_else` (#42) (');
    expect(notes).toContain('- Mail to calendar@example.com. (');
  });

  it('says when there is nothing to tell, and marks the first release', () => {
    expect(renderNotes({ tag: 'v1.0.1', previous: 'v1.0.0', commits: [commit(1, 'chore: release v1.0.1')], repoUrl })).toBe(
      'No changes since v1.0.0.\n\n**Full changelog:** [v1.0.0...v1.0.1](https://git.example.com/owner/calendar/compare/v1.0.0...v1.0.1)\n',
    );
    expect(renderNotes({ tag: 'v1.0.0', previous: null, commits: [commit(1, 'feat: the app')], repoUrl })).toBe(
      `The first release: everything up to this tag.\n\n### New\n\n- The app ([${hash(1).slice(0, 7)}](https://git.example.com/owner/calendar/commit/${hash(1)}))\n`,
    );
  });

  it('lists at most 200 commits', () => {
    const commits = Array.from({ length: 203 }, (_, i) => commit(i + 1, `fix: change ${i + 1}`));
    const notes = renderNotes({ tag: 'v1.0.1', previous: 'v1.0.0', commits });
    expect(notes.match(/^- /gm)).toHaveLength(200);
    expect(notes).toContain('…and 3 more commits.');
  });
});

// Every step starts git, which takes a while on a busy machine.
describe('releaseNotes on a repository', { timeout: 60_000 }, () => {
  let dir: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  const change = (file: string, title: string, body?: string) => {
    writeFileSync(join(dir, file), `${title}\n`);
    git('add', file);
    git('commit', '-q', '-m', title, ...(body ? ['-m', body] : []));
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    git('config', 'tag.forceSignAnnotated', 'false');
    change('a.txt', 'feat: the first feature');
    git('tag', 'v1.0.0');
    writeFileSync(join(dir, 'NOTES.md'), '## Release notes\n\n### 1.1.1\n\nWritten too early: changed after the tag.\n');
    git('add', 'NOTES.md');
    git('commit', '-q', '-m', 'docs: release notes');
    change('b.txt', 'fix: a fix on main');
    git('checkout', '-q', '-b', 'feature');
    change('c.txt', 'feat(views): a new view');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'merge: Calendar 1.1.0 - a new view', 'feature');
    change('d.txt', 'chore: version 1.1.0', 'Signed-off-by: Test <test@example.com>');
    git('tag', '-a', 'v1.1.0', '-m', 'Calendar 1.1.0', '-m', 'Written by hand for the release.');
    change('e.txt', 'chore: release v1.1.1');
    git('tag', 'v1.1.1');
    // After the tag: the notes take the file as the tag has it.
    writeFileSync(join(dir, 'NOTES.md'), '## Release notes\n\n### 1.1.1\n\nNot what the tag has.\n');
    git('commit', '-q', '-am', 'docs: release notes, later');
  }, 60_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists the commits since the version tag before, without merges and version commits', () => {
    expect(releaseNotes('v1.1.0', { cwd: dir, repoUrl: 'https://example.com/r' })).toMatch(
      /^Written by hand for the release\.\n\n### New\n\n- \*\*views:\*\* A new view \(\[[0-9a-f]{7}\]\(https:\/\/example\.com\/r\/commit\/[0-9a-f]{40}\)\)\n\n### Fixes\n\n- A fix on main \(\[[0-9a-f]{7}\]\([^)]+\)\)\n\n### Documentation\n\n- Release notes \(\[[0-9a-f]{7}\]\([^)]+\)\)\n\n\*\*Full changelog:\*\* \[v1\.0\.0\.\.\.v1\.1\.0\]\(https:\/\/example\.com\/r\/compare\/v1\.0\.0\.\.\.v1\.1\.0\)\n$/,
    );
  });

  it('takes the written notes from the file as the tag has it', () => {
    expect(releaseNotes('v1.1.1', { cwd: dir, writtenIn: 'NOTES.md' })).toBe('Written too early: changed after the tag.\n');
    // No part for the version, or no such file in the tag: the notes do without.
    expect(releaseNotes('v1.1.0', { cwd: dir, writtenIn: 'NOTES.md' })).toMatch(/^Written by hand for the release\.\n\n### New/);
    expect(releaseNotes('v1.0.0', { cwd: dir, writtenIn: 'NOTES.md' })).toMatch(/^The first release/);
  });

  it('handles the first release, a release without changes and an unknown tag', () => {
    expect(releaseNotes('v1.0.0', { cwd: dir })).toMatch(/^The first release: everything up to this tag\.\n\n### New\n\n- The first feature \([0-9a-f]{7}\)\n$/);
    expect(releaseNotes('v1.1.1', { cwd: dir })).toBe('No changes since v1.1.0.\n');
    expect(() => releaseNotes('v9.9.9', { cwd: dir })).toThrow();
    expect(() => releaseNotes('main', { cwd: dir })).toThrow(/vX\.Y\.Z/);
  });
});
