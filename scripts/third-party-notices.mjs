// Writes public/THIRD-PARTY-NOTICES.txt: the licence of every third-party
// component that ships with Calendar, for the "Open-source licences" screen
// (the file is a bundled asset, so the Android app has it offline too).
//
//   node scripts/third-party-notices.mjs           also `npm run licenses`; runs before every build
//   node scripts/third-party-notices.mjs --check   exit 1 when the file is out of date, write nothing
//
// Everything it reads is in the repository or the npm install, so it works
// offline and in the Docker build (which has no android/ folder):
//   package-lock.json + node_modules         the packages the app is built from: the production
//                                            closure, dependencies of dependencies included
//   licenses/fonts.json                      copyright lines a font package does not carry itself
//   licenses/android.json                    Maven libraries in the APK (checked against the
//                                            Gradle files when android/ is present)
//   licenses/Apache-2.0.txt                  the Apache License text, printed once
//   licenses/credits.json                    projects named out of courtesy
//   licenses/texts/<name>.txt                licence text for a package that ships none (optional;
//                                            a scoped name with "/" written as "__")
//
// It stops with an error when a package has no licence it can recognise or one
// outside ALLOWED, so that every component stays compatible with the app's
// licence (AGPL-3.0) and its notices stay complete.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public', 'THIRD-PARTY-NOTICES.txt');
const CHECK = process.argv.includes('--check');

/** Permissive licences, all compatible with the AGPL-3.0. Anything else stops the build until it is checked. */
const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'MPL-2.0', 'OFL-1.1', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'MIT-0']);

/**
 * Code the build tools write into the bundle although no package of the app
 * imports it. `section` cuts a licence file down to the part about that code.
 */
const BUILD_INJECTED = [
  { name: 'tailwindcss', what: 'base styles (preflight) compiled into the stylesheet', files: ['LICENSE'] },
  { name: 'vite', what: 'module preload helper added to the scripts', files: ['LICENSE.md'], section: ['# Vite core license', '# Licenses of bundled dependencies'] },
  { name: 'rolldown', what: 'module runtime helpers added to the scripts', files: ['LICENSE', 'THIRD-PARTY-LICENSE'] },
];

/**
 * Works of other projects that a package carries under their own licence,
 * which the package's licence file does not mention. `dir` holds that code
 * and `marker` is a line its files carry; when either is gone the entry has
 * to be looked at again. `notice` is the project's NOTICE file, which
 * Apache-2.0 section 4(d) asks to pass on.
 */
const CONTAINED = {};

/** Notices inside a package that its licence file only points to. */
const EMBEDDED = {};

const RULE = '='.repeat(78);
const LINE = '-'.repeat(78);
const failures = [];
const fail = (message) => failures.push(message);

const readText = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const readJson = (path) => JSON.parse(readText(path));
/** Licence texts as printed: no trailing blanks, no blank lines at either end. */
const tidy = (text) => text.split('\n').map((l) => l.trimEnd()).join('\n').replace(/^\n+|\n+$/g, '');
/** A sentence of ours as lines of at most 78 characters. */
const wrap = (text) => text.split(' ').reduce((lines, word) => {
  const last = lines.at(-1);
  if (last !== undefined && `${last} ${word}`.length <= 78) lines[lines.length - 1] = `${last} ${word}`;
  else lines.push(word);
  return lines;
}, /** @type {string[]} */ ([]));
const byName = (a, b) => (a.name === b.name ? cmp(a.version, b.version) : cmp(a.name, b.name));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- licences

/**
 * The licence terms Calendar uses a component under, given its SPDX
 * expression: `OR` takes the first allowed alternative, `AND` needs all of its
 * parts allowed, `WITH` exceptions are not accepted. Null when nothing allowed
 * is left, or the expression cannot be read.
 */
function chosenLicence(expression) {
  if (typeof expression !== 'string') return null;
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  function either() {
    let pick = both();
    while (peek() === 'OR') {
      at++;
      const next = both();
      pick ??= next;
    }
    return pick;
  }
  function both() {
    const parts = [term()];
    while (peek() === 'AND') {
      at++;
      parts.push(term());
    }
    return parts.every(Boolean) ? parts.join(' AND ') : null;
  }
  function term() {
    const token = tokens[at++];
    if (token === '(') {
      const inner = either();
      if (tokens[at++] !== ')') throw new SyntaxError(expression);
      return inner && /\sAND\s/.test(inner) ? `(${inner})` : inner;
    }
    if (!token || token === ')' || token === 'AND' || token === 'OR') throw new SyntaxError(expression);
    if (peek() === 'WITH') {
      at += 2;
      return null;
    }
    return ALLOWED.has(token) ? token : null;
  }
  try {
    const pick = either();
    return at === tokens.length ? pick : null;
  } catch {
    return null;
  }
}

/** Why a declared licence cannot be accepted, or null when it can. */
function licenceProblem(expression) {
  if (!expression || typeof expression !== 'string') return 'no licence';
  if (/^\(?\s*(UNLICENSED|SEE LICEN[CS]E IN\b)/i.test(expression)) return `a licence that is not a known open-source licence ("${expression}")`;
  return chosenLicence(expression) ? null : `licence ${expression}, which is not on the allow-list`;
}

/** "MIT", or "MIT, chosen from (MIT OR Apache-2.0)" for a choice of licences. */
function licenceLabel(expression) {
  const pick = chosenLicence(expression);
  return pick && pick !== expression && pick !== expression.replace(/^\((.*)\)$/, '$1') ? `${pick}, chosen from ${expression}` : expression;
}

/** The licence as package.json declares it, in its current or one of its old forms. */
function declaredLicence(pkg) {
  const value = pkg.license ?? pkg.licenses;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean).join(' OR ') || null;
  return value?.type ?? null;
}

/** Recognises a few licence texts, for a package.json that declares none. Deliberately narrow. */
function detectLicence(text) {
  const t = text.replace(/\s+/g, ' ');
  if (/Mozilla Public License,? Version 2\.0/i.test(t)) return 'MPL-2.0';
  if (/SIL OPEN FONT LICENSE Version 1\.1/i.test(t)) return 'OFL-1.1';
  if (/Apache License,? Version 2\.0/i.test(t) && !/GNU|General Public License/i.test(t)) return 'Apache-2.0';
  if (/GNU|General Public License|Creative Commons Attribution|Server Side Public License|Business Source License/i.test(t)) return null;
  if (/Permission is hereby granted, free of charge/i.test(t) && /above copyright notice and this permission notice shall be included/i.test(t)) return 'MIT';
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted, provided that/i.test(t)) return 'ISC';
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  return null;
}

const COPYRIGHT = /^(portions\s+)?(copyright\b(?!\s+(notices?|licen[cs]es?|holders?|owners?|statements?|and\b|laws?\b))|©|\(c\)\s*(\d|copyright))/i;

/** The copyright lines of a licence text or a source header, verbatim but for comment markers. */
function copyrightLines(text) {
  const found = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s/*#>-]+/, '').replace(/\s*\*\/.*$/, '').trim();
    if (COPYRIGHT.test(line) && !/\[yyyy\]|<year>/i.test(line) && !found.includes(line)) found.push(line);
  }
  return found;
}

/** The first comment block of a source file, without the comment markers. */
function leadingComment(source) {
  const m = source.match(/^\s*\/\*+([\s\S]*?)\*\//);
  return m ? m[1].split('\n').map((l) => l.replace(/^\s*\*? ?/, '')).join('\n') : '';
}

const LICENCE_FILE = /^(licen[cs]e|copying)([.-].*)?$/i;
const NOTICE_FILE = /^notice([.-].*)?$/i;

function licenceFiles(dir) {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && (LICENCE_FILE.test(d.name) || NOTICE_FILE.test(d.name)))
    .map((d) => d.name);
  // Licence first, then NOTICE files (Apache-2.0 section 4(d) asks for both).
  return names.sort((a, b) => Number(NOTICE_FILE.test(a)) - Number(NOTICE_FILE.test(b)) || cmp(a, b));
}

/** Where `packages/<name>` would be found from `from`, the way Node resolves it. */
function resolveInLock(packages, from, name) {
  for (let base = from; ; ) {
    const path = `${base ? `${base}/` : ''}node_modules/${name}`;
    if (packages[path]) return path;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

/**
 * The packages an install with `--omit=dev` would contain: everything reachable
 * from `dependencies`, plus whatever npm itself marks as not dev-only (the two
 * agree; taking both means nothing is missed if they ever do not).
 */
function productionClosure(lock, where) {
  const packages = lock.packages ?? {};
  const root = packages[''] ?? {};
  const found = new Map();
  const queue = [];
  const visit = (from, name, optional) => {
    let path = resolveInLock(packages, from, name);
    if (path && packages[path].link) path = packages[path].resolved;
    if (!path || !packages[path]) {
      if (!optional) fail(`${where}: ${name}, needed by ${from || 'the app'}, is missing. Run npm install to bring it up to date.`);
      return;
    }
    if (found.has(path)) return;
    if (packages[path].dev) fail(`${where}: ${path} is marked as a development package, yet the app depends on it.`);
    found.set(path, packages[path]);
    queue.push(path);
  };
  for (const name of Object.keys(root.dependencies ?? {})) visit('', name, false);
  for (const name of Object.keys(root.optionalDependencies ?? {})) visit('', name, true);
  while (queue.length) {
    const path = queue.shift();
    const entry = packages[path];
    for (const name of Object.keys(entry.dependencies ?? {})) visit(path, name, false);
    for (const name of Object.keys(entry.optionalDependencies ?? {})) visit(path, name, true);
    // Optional peers are left to the app; the ones it uses are its own dependencies.
    for (const name of Object.keys(entry.peerDependencies ?? {})) {
      if (!entry.peerDependenciesMeta?.[name]?.optional) visit(path, name, true);
    }
  }
  for (const [path, entry] of Object.entries(packages)) {
    if (path && !entry.dev && !entry.devOptional && !entry.link && !found.has(path)) found.set(path, entry);
  }
  return [...found].map(([path, entry]) => ({ path, entry, name: entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 13), version: entry.version }));
}

/** A browsable address for package.json's `repository`. */
function repositoryUrl(pkg) {
  let url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!url) return pkg.homepage ?? null;
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `github:${url}`;
  url = url
    .replace(/^git\+/, '')
    .replace(/^github:/, 'https://github.com/')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
    .replace(/\.git$/, '');
  return url;
}

// ---------------------------------------------------------------- npm packages of the app

const lockPath = join(ROOT, 'package-lock.json');
const app = readJson(join(ROOT, 'package.json'));
const lock = readJson(lockPath);
const installed = [];

for (const item of productionClosure(lock, 'package-lock.json')) {
  const dir = join(ROOT, item.path);
  if (!existsSync(join(dir, 'package.json'))) {
    if (item.entry.optional) continue; // an optional package for another platform
    fail(`${item.name} ${item.version} is not installed. Run npm ci first.`);
    continue;
  }
  const pkg = readJson(join(dir, 'package.json'));
  const files = licenceFiles(dir);
  const override = join(ROOT, 'licenses', 'texts', `${item.name.replace('/', '__')}.txt`);
  let text = files.map((f) => tidy(readText(join(dir, f)))).join('\n\n');
  if (!text && existsSync(override)) text = tidy(readText(override));
  let licence = declaredLicence(pkg);
  let detected = false;
  if (!licence && text) {
    licence = detectLicence(text);
    detected = Boolean(licence);
  }
  const problem = licenceProblem(licence);
  if (problem) fail(`${item.name} ${pkg.version} has ${problem}. Replace it, or confirm the licence is compatible with the AGPL-3.0 and extend ALLOWED in scripts/third-party-notices.mjs.`);
  if (!text) fail(`${item.name} ${pkg.version} ships no licence file. Put its licence text into licenses/texts/${item.name.replace('/', '__')}.txt.`);
  installed.push({ name: item.name, version: pkg.version, licence, detected, text, dir, pkg, resolved: item.entry.resolved });
}

/** Copyright lines for a package: from its licence, else from the header of its entry file. */
function packageCopyright(p) {
  const lines = copyrightLines(p.text);
  if (lines.length) return lines;
  const exp = p.pkg.exports;
  const entries = [p.pkg.module, p.pkg.main, typeof exp === 'string' ? exp : exp?.import ?? exp?.['.']?.import, 'index.js'];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const file = join(p.dir, entry);
    if (!existsSync(file)) continue;
    const head = copyrightLines(readText(file).slice(0, 4000));
    if (head.length) return head;
  }
  return [];
}

// ---------------------------------------------------------------- fonts

const fontData = readJson(join(ROOT, 'licenses', 'fonts.json')).fonts ?? {};
const OFL_START = /^-+\nSIL OPEN FONT LICENSE Version 1\.1/m;
const fonts = [];
const packagesInApp = [];
let oflText = null;

for (const p of installed) {
  if (p.licence !== 'OFL-1.1') {
    packagesInApp.push(p);
    continue;
  }
  // Fontsource's LICENSE is the font's copyright header followed by the OFL text.
  const at = p.text.search(OFL_START);
  const header = at === -1 ? '' : p.text.slice(0, at);
  const body = at === -1 ? null : tidy(p.text.slice(at));
  let copyright = header.split('\n').map((l) => l.trim()).filter((l) => /copyright/i.test(l));
  let note = '';
  if (!copyright.length) {
    const extra = fontData[p.name];
    if (extra?.copyright) {
      copyright = [extra.copyright];
      note = "from the font's upstream OFL.txt";
    } else fail(`${p.name} ${p.version} carries no copyright line in its LICENSE. Add it to licenses/fonts.json from the font's upstream OFL.txt.`);
  }
  if (/Reserved Font Name/i.test([header, ...copyright].join('\n'))) {
    fail(`${p.name} reserves its font name, and fonts with a Reserved Font Name are not used in this project.`);
  }
  let family = p.name;
  const meta = join(p.dir, 'metadata.json');
  if (existsSync(meta)) family = readJson(meta).family ?? family;
  // The OFL text is printed once; a font whose licence reads differently keeps its own.
  if (body) oflText ??= body;
  const ownText = body && body.replace(/\s+/g, ' ') === oflText.replace(/\s+/g, ' ') ? null : p.text;
  fonts.push({ ...p, family, copyright, note, ownText });
}
for (const name of Object.keys(fontData)) {
  const used = fonts.find((f) => f.name === name);
  if (!used) console.warn(`third-party-notices: licenses/fonts.json names ${name}, which the app does not use any more.`);
  else if (!used.note) console.warn(`third-party-notices: licenses/fonts.json entry for ${name} is not needed: the package carries its own copyright line.`);
}

// ---------------------------------------------------------------- code added by the build tools

const injected = [];
for (const tool of BUILD_INJECTED) {
  const dir = join(ROOT, 'node_modules', tool.name);
  if (!existsSync(join(dir, 'package.json'))) {
    fail(`${tool.name} is not installed, so its licence cannot be listed. Run npm ci first.`);
    continue;
  }
  const pkg = readJson(join(dir, 'package.json'));
  const problem = licenceProblem(declaredLicence(pkg));
  if (problem) fail(`${tool.name} ${pkg.version} has ${problem}.`);
  let text = tool.files.map((f) => tidy(readText(join(dir, f)))).join('\n\n');
  if (tool.section) {
    const [from, to] = tool.section;
    const start = text.indexOf(from);
    const end = text.indexOf(to, start);
    if (start === -1 || end === -1) fail(`The licence file of ${tool.name} ${pkg.version} has changed its layout; update BUILD_INJECTED.`);
    else text = tidy(text.slice(start + from.length, end));
  }
  injected.push({ name: tool.name, version: pkg.version, licence: declaredLicence(pkg), what: tool.what, text });
}

// ---------------------------------------------------------------- Android

/** Licences other than the open-source ones above that an Android library may come under (none at present). */
const ANDROID_LICENCES = new Map();

const androidList = readJson(join(ROOT, 'licenses', 'android.json')).libraries ?? [];
for (const lib of androidList) {
  const problem = ANDROID_LICENCES.has(lib.license) ? null : licenceProblem(lib.license);
  if (problem) fail(`licenses/android.json: ${lib.id} has ${problem}.`);
  // Only the Apache License text is printed for all of them; any other one comes with its own text.
  else if (lib.license !== 'Apache-2.0') {
    const path = lib.text ? join(ROOT, 'licenses', lib.text) : null;
    if (path && existsSync(path)) lib.licenceText = tidy(readText(path));
    else fail(`licenses/android.json: ${lib.id} is not under Apache-2.0; put its licence text under licenses/ and name the file in its "text" field.`);
  }
}

/**
 * The libraries the Gradle files ask for directly, with their versions. Only
 * possible with the android/ folder at hand; the transitive ones need Gradle
 * (see licenses/android.json).
 */
function gradleDirectDependencies() {
  const android = join(ROOT, 'android');
  const settings = join(android, 'capacitor.settings.gradle');
  if (!existsSync(join(android, 'app', 'build.gradle'))) return null;
  const vars = {};
  const variables = join(android, 'variables.gradle');
  if (existsSync(variables)) for (const m of readText(variables).matchAll(/(\w+)\s*=\s*['"]([^'"]+)['"]/g)) vars[m[1]] = m[2];
  const modules = [join(android, 'app', 'build.gradle'), join(android, 'capacitor-cordova-android-plugins', 'build.gradle')];
  if (existsSync(settings)) {
    for (const m of readText(settings).matchAll(/new File\('([^']+)'\)/g)) modules.push(join(android, m[1], 'build.gradle'));
  }
  const coords = new Map();
  for (const file of modules) {
    if (!existsSync(file)) continue;
    const source = readText(file);
    // A module's own default applies only where variables.gradle sets nothing.
    const local = { ...vars };
    for (const m of source.matchAll(/(\w+)\s*=\s*project\.hasProperty\('\w+'\)\s*\?\s*rootProject\.ext\.\w+\s*:\s*'([^']+)'/g)) local[m[1]] ??= m[2];
    // Also what one build type or flavour alone asks for (e.g. `releaseImplementation`).
    for (const m of source.matchAll(/^\s*(?:\w*[iI]mplementation|api|runtimeOnly)\s*\(?\s*["']([^"']+)["']/gm)) {
      const coord = m[1].replace(/\$\{?(\w+)\}?/g, (_, name) => local[name] ?? `$${name}`);
      // Capacitor plugins name the published core only when they are being published themselves.
      if (coord.startsWith('com.capacitorjs:')) continue;
      // Libraries of the unit tests and of the instrumented tests are not part of the app.
      if (/^\s*(?:test|androidTest)\w*Implementation\b/.test(m[0])) continue;
      coords.set(coord, file.slice(ROOT.length).replace(/\\/g, '/'));
    }
  }
  return coords;
}

const direct = gradleDirectDependencies();
if (direct) {
  const listed = new Set(androidList.map((l) => l.id));
  for (const [coord, file] of direct) {
    if (coord.includes('$')) fail(`${file}: cannot work out the version of ${coord}.`);
    else if (!listed.has(coord)) fail(`${file} asks for ${coord}, which licenses/android.json does not list. Refresh that list (see its $comment).`);
  }
}

const credits = readJson(join(ROOT, 'licenses', 'credits.json')).credits ?? [];
const apacheText = tidy(readText(join(ROOT, 'licenses', 'Apache-2.0.txt')));

if (failures.length) {
  console.error('third-party-notices: cannot write the notices:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// ---------------------------------------------------------------- the file

packagesInApp.sort(byName);
fonts.sort(byName);
const DATE_LINE = /^Generated on \d{4}-\d{2}-\d{2}\b.*$/m;

const out = [];
const add = (...lines) => out.push(...lines);
const heading = (title) => add('', '', RULE, title, RULE);
const entry = (title) => add('', LINE, title);

add(
  `Calendar (Kalendarz) ${app.version}: third-party notices`,
  `Generated on ${new Date().toISOString().slice(0, 10)} by scripts/third-party-notices.mjs.`,
  '',
  'Calendar is free software: Copyright (c) 2026 patryk.pro, licensed under',
  'the GNU Affero General Public License version 3 (see LICENSE). It contains the',
  'third-party components listed below. Each of them remains under its own',
  'licence, reproduced here.',
  '',
  'Contents',
  `  1. Packages in the web and Android app (${packagesInApp.length})`,
  `  2. Fonts (${fonts.length})`,
  `  3. Code added by the build tools (${injected.length})`,
  `  4. Android libraries (${androidList.length})`,
  '  5. Credits',
  `  6. Licence texts: Apache License 2.0${oflText ? ', SIL Open Font License 1.1' : ''}`,
);

heading('1. Packages in the web and Android app');
for (const p of packagesInApp) {
  entry(`${p.name} ${p.version}`);
  add(`Licence: ${licenceLabel(p.licence)}${p.detected ? ' (recognised from its licence file)' : ''}`);
  for (const line of packageCopyright(p)) add(line);
  const repo = repositoryUrl(p.pkg);
  if (repo) add(`Source: ${repo}`);
  const chosen = chosenLicence(p.licence);
  if (/\bMPL-2\.0\b/.test(chosen)) {
    // MPL-2.0 section 3.2: say where the source of the executable form is.
    const tag = repo && /github\.com|gitlab\.com|codeberg\.org/.test(repo) ? `${repo}/tree/v${p.version}` : null;
    add('', 'Included unmodified, in executable form. Its source code is available under', 'the Mozilla Public License 2.0 (text below):');
    if (tag) add(`  ${tag}`);
    if (p.resolved) add(`  ${p.resolved} (the published package)`);
  }
  if (/\bApache-2\.0\b/.test(chosen) && !/TERMS AND CONDITIONS FOR USE/.test(p.text)) {
    add('', 'The full text of the Apache License 2.0 is in part 6.');
  }
  add('', p.text);
  for (const file of EMBEDDED[p.name] ?? []) {
    const path = join(p.dir, file);
    if (!existsSync(path)) continue;
    const notice = tidy(leadingComment(readText(path)));
    if (notice) add('', `Notice in ${file}, part of the code above:`, '', notice);
  }
  for (const work of CONTAINED[p.name] ?? []) {
    const dir = join(p.dir, work.dir);
    const files = existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile()) : [];
    if (!files.some((f) => readText(join(f.parentPath ?? f.path, f.name)).includes(work.marker))) {
      fail(`${p.name} ${p.version} no longer carries ${work.title.split(' (')[0]} in ${work.dir}; update CONTAINED.`);
      continue;
    }
    add(
      '',
      ...wrap(`Contains ${work.title}.`),
      `Licence: ${work.licence}${work.licence === 'Apache-2.0' ? ' (text in part 6)' : ''}`,
      `Source: ${work.source}`,
      '',
      'Its NOTICE:',
      '',
      ...work.notice.map((line) => (line ? `  ${line}` : '')),
    );
  }
}

heading('2. Fonts');
add(
  '',
  'The fonts are packaged by Fontsource and licensed under the SIL Open Font',
  'License 1.1, whose text is in part 6. They are bundled with Calendar and are',
  'not sold on their own.',
);
for (const f of fonts) {
  entry(`${f.family}: ${f.name} ${f.version}`);
  add('Licence: OFL-1.1');
  for (const line of f.copyright) add(line);
  if (f.note) add(`(${f.note})`);
  if (f.ownText) add('', f.ownText);
}

heading('3. Code added by the build tools');
add('', 'Small parts of these tools end up in the files of the app.');
for (const tool of injected) {
  entry(`${tool.name} ${tool.version}: ${tool.what}`);
  add(`Licence: ${licenceLabel(tool.licence)}`, '', tool.text);
}

heading('4. Android libraries');
add(
  '',
  'The Android app also contains these libraries. Each is licensed under the',
  'Apache License 2.0 (text in part 6) unless another licence is named.',
  "Capacitor's Android runtime and plugins are listed in part 1.",
  '',
);
const androidSorted = [...androidList].sort((a, b) => cmp(a.id, b.id));
const idWidth = Math.max(0, ...androidList.map((l) => l.id.length));
const licenceName = (lib) => ANDROID_LICENCES.get(lib.license) ?? licenceLabel(lib.license);
for (const lib of androidSorted) {
  const notes = [lib.licenceText ? `${licenceName(lib)}, text below` : null].filter(Boolean);
  add(`${lib.id.padEnd(idWidth)}  ${lib.name ?? ''}${notes.length ? `  [${notes.join('; ')}]` : ''}`.trimEnd());
}
// A licence text shared by several libraries is printed once, after the list of them.
const byText = new Map();
for (const lib of androidSorted.filter((l) => l.licenceText)) {
  const group = byText.get(lib.licenceText) ?? { licence: licenceName(lib), ids: [] };
  group.ids.push(lib.id);
  byText.set(lib.licenceText, group);
}
for (const [text, group] of byText) {
  entry(`${group.licence}: ${group.ids.join(', ')}`);
  add('', text);
}

heading('5. Credits');
add('', 'Ideas from these projects inspired parts of Calendar.', '');
for (const c of credits) add(`${c.name}: ${c.url}`);

heading('6. Licence texts');
entry('Apache License 2.0');
add('', apacheText);
if (oflText) {
  entry('SIL Open Font License 1.1');
  add('', oflText);
}

const text = `${out.join('\n')}\n`;
const previous = existsSync(OUT) ? readText(OUT) : null;
const same = previous !== null && previous.replace(DATE_LINE, '') === text.replace(DATE_LINE, '');
const summary = `${packagesInApp.length} packages, ${fonts.length} fonts, ${injected.length} build tools, ${androidList.length} Android libraries`;

if (CHECK) {
  if (!same) {
    console.error('third-party-notices: public/THIRD-PARTY-NOTICES.txt is out of date. Run npm run licenses.');
    process.exit(1);
  }
  console.log(`third-party-notices: up to date (${summary}).`);
} else if (same) {
  // Unchanged content keeps its date, so a build leaves the committed file alone.
  console.log(`third-party-notices: unchanged (${summary}).`);
} else {
  writeFileSync(OUT, text);
  console.log(`third-party-notices: wrote ${OUT.slice(ROOT.length).replace(/\\/g, '/')} (${summary}).`);
}
