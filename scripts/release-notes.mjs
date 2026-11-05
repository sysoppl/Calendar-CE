// The release notes of a version tag, in Markdown: what changed since the
// version tag before it, from the commit titles (Conventional Commits),
// grouped by kind. The release workflow publishes them with the release.
//
//   node scripts/release-notes.mjs v1.12.0 [--written-in README.md] [--repo-url <url>] [--out <file>]
//
// The commits are the tag's, back to the highest version tag below it (all of
// them for the first release); merges are left out, their commits are not.
// Commits that only set the version ("chore: release v1.10.1", "chore:
// version 1.12.0 - persistent notifications") and the merge of a release
// ("merge: Calendar 1.12.0 - …") are not listed.
//
// Above the list: the body of an annotated tag, if it has one, and the part
// "### X.Y.Z" of the "## Release notes" section of the --written-in file (as
// the tag has it), if there is one. Without either, the words of the version
// commit (the text after " - ", or else the first paragraph of its message).
//
// Links to the commits and a comparison with the tag before need the address
// of the repository: --repo-url, or GITHUB_SERVER_URL and GITHUB_REPOSITORY,
// which GitHub Actions and compatible runners set. Without one the notes name
// the commits by their short hash only.
//
// No dependencies: it only runs git, so a job can use it before (or without)
// installing anything. Needs the whole history and the tags (a checkout with
// fetch-depth: 0).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A version tag as the release workflows take them: vX.Y.Z. */
export const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The sections of the notes, in their order, and the commit types that go into each. */
export const SECTIONS = [
  { title: 'Breaking changes', types: [] },
  { title: 'New', types: ['feat'] },
  { title: 'Fixes', types: ['fix'] },
  { title: 'Performance', types: ['perf'] },
  { title: 'Documentation', types: ['docs'] },
  { title: 'Maintenance', types: ['refactor', 'test', 'ci', 'build', 'chore', 'style', 'revert', 'deps'] },
  { title: 'Other changes', types: [] },
];

/** At most this many entries; the comparison link shows the rest. */
const MAX_ENTRIES = 200;

/** The types a title may start with; "Android: …" or "README: …" is a plain title. */
const TYPES = new Set(SECTIONS.flatMap((s) => s.types));

/** [major, minor, patch] of a version tag, or null. */
export function versionOf(tag) {
  const match = VERSION_TAG.exec(tag);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The highest version tag below `tag` among `tags`, or null when there is none (the first release). */
export function previousTag(tag, tags) {
  const own = versionOf(tag);
  if (!own) throw new Error(`Not a version tag (vX.Y.Z): ${tag}`);
  let best = null;
  for (const candidate of tags) {
    const version = versionOf(candidate);
    if (version && compareVersions(version, own) < 0 && (!best || compareVersions(version, best.version) > 0)) best = { tag: candidate, version };
  }
  return best?.tag ?? null;
}

/**
 * A commit title read as a Conventional Commit: `type(scope)!: description`,
 * with one of the types the sections know. Anything else is type null, with
 * the whole title as its description.
 */
export function parseTitle(title) {
  const match = /^([a-zA-Z]+)(?:\(([^()]*)\))?(!)?:\s*(.*\S)\s*$/.exec(title);
  if (!match || !TYPES.has(match[1].toLowerCase())) return { type: null, scope: null, breaking: false, description: title.trim() };
  return { type: match[1].toLowerCase(), scope: match[2]?.trim() || null, breaking: match[3] === '!', description: match[4] };
}

/** A version number as a word of its own: 1.2.3 or v1.2.3. */
const VERSION_WORD = String.raw`v?\d+\.\d+\.\d+(?![\w.-])`;
/** Up to two words before the version, such as the product's name ("Calendar CE 1.2.3"). */
const NAMED_VERSION = String.raw`(?:[^\s:]+\s+){0,2}?${VERSION_WORD}`;
const VERSION_TITLE = new RegExp(
  [
    // chore: release v1.2.3 · chore: version 1.2.3 - … · chore: bump the version to 1.2.3
    String.raw`^chore(?:\([^()]*\))?!?:\s*(?:release|version|bump(?:\s+the)?\s+version\s+to)\s+${VERSION_WORD}`,
    // chore(release): … (whatever it says)
    String.raw`^chore\(release\)!?:`,
    // release: v1.2.3 · release: Calendar 1.2.3 - …
    String.raw`^release(?:\([^()]*\))?!?:\s*${NAMED_VERSION}`,
    // Release v1.2.3
    String.raw`^release\s+${VERSION_WORD}`,
  ].join('|'),
  'i',
);
const RELEASE_MERGE = new RegExp(String.raw`^merge:\s*${NAMED_VERSION}`, 'i');

/** True for a commit that only sets the version, or the merge of a release ("merge: Calendar 1.2.3 - …"). */
export function isVersionCommit(title, merge = false) {
  return (merge ? RELEASE_MERGE : VERSION_TITLE).test(title);
}

/** Lines git adds to the end of a message, which say nothing about the change. */
const TRAILER = /^(?:signed-off-by|co-authored-by|reviewed-by|acked-by|tested-by|reported-by|suggested-by|helped-by|cc|change-id):\s+\S/i;

/** The paragraphs of a message, without the trailers ("Signed-off-by: …") at its end. */
function withoutTrailers(body) {
  const paragraphs = body.trim().split(/\n\s*\n/);
  const last = paragraphs.at(-1) ?? '';
  if (last && last.split('\n').every((line) => TRAILER.test(line))) paragraphs.pop();
  return paragraphs.filter((p) => p.trim());
}

/** A paragraph of a commit message as one line of text. */
const oneLine = (text) => text.replace(/\s*\n\s*/g, ' ').trim();

/** First letter upper case. */
const capitalise = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** First letter upper case, and a full stop at the end. */
function sentence(text) {
  const capital = capitalise(text.trim());
  return !capital || /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** What a version commit or a release merge says about the release, or ''. */
export function summaryOf(commit) {
  const dash = /\s[-–—]\s+(.+)$/.exec(commit.title);
  if (dash) return sentence(dash[1]);
  if (commit.merge) return '';
  const first = withoutTrailers(commit.body ?? '')[0];
  return first ? sentence(oneLine(first)) : '';
}

/**
 * Markdown with its special characters taken literally (titles may hold `*`,
 * `_`, `<`, …). A word with an @ ("@capacitor/core", "@someone") goes into a
 * code span, so that a release page does not take it for a mention of
 * somebody. "#" stays: in "(#42)" it links the pull request.
 */
function escapeMarkdown(text) {
  return text
    // Not the @ of an e-mail address: only one that starts a word.
    .split(/((?<![\w.])@\w(?:[\w./-]*\w)?)/)
    .map((part, i) => (i % 2 ? `\`${part}\`` : part.replace(/([\\`*_[\]<>|~])/g, '\\$1')))
    .join('');
}

/**
 * Links of a file's text, made absolute for a release page: "#a-section" and
 * "docs/FILE.md" point into the file and the repository as the tag has them.
 * Addresses with a scheme, and links to "/", are left as they are.
 */
export function absoluteLinks(markdown, { repoUrl, tag, file }) {
  const base = repoUrl.replace(/\/+$/, '');
  if (!base) return markdown;
  // GitHub shows a file of a tag under /blob/<tag>/, Gitea and Forgejo under /src/tag/<tag>/.
  const tree = /^https?:\/\/(www\.)?github\.com\//i.test(base) ? `${base}/blob/${tag}` : `${base}/src/tag/${tag}`;
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  return markdown.replace(/(\]\()([^)\s]+)(\))/g, (whole, open, target, close) => {
    if (/^[a-z][a-z0-9+.-]*:|^\/|^\/\//i.test(target)) return whole;
    if (target.startsWith('#')) return `${open}${tree}/${file}${target}${close}`;
    return `${open}${tree}/${dir}${target.replace(/^\.\//, '')}${close}`;
  });
}

/**
 * The part for `version` (X.Y.Z) of a Markdown file's "## Release notes"
 * section: the text under its "### X.Y.Z" heading (also "### v1.2.3" and
 * "### 1.2.3 (5 November 2026)"), up to the next heading of that level or
 * above. '' when there is none.
 */
export function releaseNotesSection(markdown, version) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  /** The version a heading starts with, as a word of its own ("1.2.1 (5 Nov)", not "1.2.10"). */
  const versionOf = (text) => /^v?(\d+\.\d+\.\d+)(?![\w.-])/.exec(text)?.[1];
  let inSection = false;
  let start = -1;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const level = heading[1].length;
    if (start !== -1 && level <= 3) return lines.slice(start, i).join('\n').trim();
    if (level <= 2) inSection = level === 2 && /^release notes$/i.test(heading[2]);
    else if (inSection && level === 3 && versionOf(heading[2]) === version) start = i + 1;
  }
  return start === -1 ? '' : lines.slice(start).join('\n').trim();
}

/**
 * Markdown with its hard-wrapped lines joined: release pages break a line
 * wherever the text does. Fenced code, headings, list items, quotes, tables,
 * rules and lines that end in a deliberate break stay apart. (Code indented
 * by four spaces is not told apart from a wrapped line: use a fence.)
 */
export function unwrap(markdown) {
  const out = [];
  let fence = false;
  let joinable = false;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      out.push(line);
      joinable = false;
      continue;
    }
    if (fence || !line.trim()) {
      out.push(line);
      joinable = false;
      continue;
    }
    // A rule ("---", "***", "___") or the underline of a heading ("===").
    const rule = /^\s*([-*_=])(\s*\1){2,}\s*$/.test(line);
    const startsBlock = rule || /^\s*([-*+]\s|\d+[.)]\s|#|>|\|)/.test(line);
    // Only the indentation goes: two spaces at the end are a break of their own.
    if (joinable && !startsBlock) out[out.length - 1] += ` ${line.trimStart()}`;
    else out.push(line);
    joinable = !rule && !/^\s*(#|\|)/.test(line) && !/ {2}$|\\$/.test(line);
  }
  return out.join('\n');
}

/**
 * The notes, from what git said. `commits` are newest first, each
 * `{ hash, title, body, merge }`; `tagBody` is the annotated tag's message
 * without its first line ('' for a lightweight tag); `written` is what was
 * written down for the release by hand (see releaseNotesSection).
 */
export function renderNotes({ tag, previous, commits, tagBody = '', written = '', repoUrl = '' }) {
  const base = repoUrl.replace(/\/+$/, '');
  const ref = (hash) => (base ? `([${hash.slice(0, 7)}](${base}/commit/${hash}))` : `(${hash.slice(0, 7)})`);

  // The tag's message as written (lists stay lists), its wrapped lines joined.
  const intro = unwrap(withoutTrailers(tagBody).join('\n\n')).trim();
  // The newest version commit or release merge with something to say speaks for the release.
  let summary = '';
  const sections = new Map(SECTIONS.map((s) => [s.title, []]));
  let listed = 0;
  let left = 0;
  for (const commit of commits) {
    if (isVersionCommit(commit.title, commit.merge)) {
      summary ||= summaryOf(commit);
      continue;
    }
    if (commit.merge) continue;
    const parsed = parseTitle(commit.title);
    const breaking = parsed.breaking || /^BREAKING[ -]CHANGE:/m.test(commit.body ?? '');
    const section = breaking
      ? 'Breaking changes'
      : (SECTIONS.find((s) => parsed.type && s.types.includes(parsed.type))?.title ?? 'Other changes');
    if (listed >= MAX_ENTRIES) {
      left++;
      continue;
    }
    const scope = parsed.scope ? `**${escapeMarkdown(parsed.scope)}:** ` : '';
    sections.get(section).push(`- ${scope}${escapeMarkdown(capitalise(parsed.description))} ${ref(commit.hash)}`);
    listed++;
  }

  const out = [];
  if (intro) out.push(intro, '');
  if (written.trim()) out.push(unwrap(written.trim()), '');
  // The version commit's few words only when nothing longer was written.
  else if (summary && !intro) out.push(escapeMarkdown(summary), '');
  if (!previous) out.push(`The first release${listed ? ': everything up to this tag.' : '.'}`, '');
  for (const { title } of SECTIONS) {
    const entries = sections.get(title);
    if (!entries.length) continue;
    out.push(`### ${title}`, '', ...entries, '');
  }
  if (left) out.push(`…and ${left} more ${left === 1 ? 'commit' : 'commits'}.`, '');
  if (!listed && !summary && !intro && !written.trim() && previous) out.push(`No changes since ${previous}.`, '');
  if (previous && base) out.push(`**Full changelog:** [${previous}...${tag}](${base}/compare/${previous}...${tag})`, '');
  return `${out.join('\n').trim()}\n`;
}

function git(args, cwd) {
  // git's complaints end up in the error, not on the console.
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The commits of `tag` back to `previous` (all of them without one), newest first. */
export function readCommits(tag, previous, cwd = process.cwd()) {
  const range = previous ? `${previous}..${tag}` : tag;
  // Fields and records are split by control characters that commit messages do not hold.
  // --no-show-signature: a log.showSignature setting would mix gpg's output into the records.
  const raw = git(['log', '--no-show-signature', '--format=%H%x1f%P%x1f%s%x1f%b%x1e', range, '--'], cwd);
  return raw
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [hash, parents, title, body] = record.split('\x1f');
      return { hash, title, body: body ?? '', merge: parents.trim().split(/\s+/).length > 1 };
    });
}

/**
 * The notes of `tag` in the repository at `cwd`. `writtenIn` names a
 * Markdown file of the repository whose "## Release notes" section may have a
 * part for this version; it is read as the tag has it.
 */
export function releaseNotes(tag, { cwd = process.cwd(), repoUrl = '', writtenIn = '' } = {}) {
  const version = versionOf(tag);
  if (!version) throw new Error(`Not a version tag (vX.Y.Z): ${tag}`);
  git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], cwd);
  const tags = git(['tag', '--list', 'v*'], cwd).split('\n').map((t) => t.trim()).filter(Boolean);
  const previous = previousTag(tag, tags);
  const commits = readCommits(tag, previous, cwd);
  // %(contents:body) is empty for a lightweight tag and for one with a title only.
  const tagBody = git(['tag', '--list', '--format=%(contents:body)', tag], cwd);
  let written = '';
  if (writtenIn) {
    let text = '';
    try {
      text = git(['show', `${tag}:${writtenIn}`], cwd);
    } catch {
      // The file is not in this tag: nothing written for it.
    }
    // Its links point into the file and the repository as the tag has them.
    written = absoluteLinks(releaseNotesSection(text, version.join('.')), { repoUrl, tag, file: writtenIn });
  }
  return renderNotes({ tag, previous, commits, tagBody, written, repoUrl });
}

function main(argv) {
  const args = [...argv];
  const option = (name) => {
    const at = args.indexOf(name);
    if (at === -1) return undefined;
    const [, value] = args.splice(at, 2);
    if (value === undefined) throw new Error(`${name} needs a value`);
    return value;
  };
  const out = option('--out');
  const writtenIn = option('--written-in') ?? '';
  const repoUrl =
    option('--repo-url') ??
    (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}` : '');
  const [tag] = args;
  if (!tag || args.length > 1) throw new Error('Usage: node scripts/release-notes.mjs vX.Y.Z [--written-in <file>] [--repo-url <url>] [--out <file>]');
  const notes = releaseNotes(tag, { repoUrl, writtenIn });
  if (out) writeFileSync(out, notes);
  else process.stdout.write(notes);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`release-notes: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
