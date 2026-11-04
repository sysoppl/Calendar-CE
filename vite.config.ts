/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
import { handleDavProxy } from './server/davProxy.mjs';
import { resolveLinks, resolvePublicConfig } from './server/publicConfig.mjs';
import { contentSecurityPolicy, securityHeaders } from './server/securityHeaders.mjs';
// Makes every build's service worker a new one, which drops the caches of the builds before.
import { serviceWorkerVersion } from './scripts/sw-version.mjs';
// Stops a build that is not a production one or still carries the seeder.
import { developmentGuard } from './scripts/development-guard.mjs';

/**
 * The licence text next to the app (LICENSE.txt): every copy of the bundle
 * that is passed on, the Android app and the Docker image, carries it.
 */
function licenseFile(): Plugin {
  return {
    name: 'calendar-license-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8') });
    },
  };
}

/** Mounts the DAV proxy on the dev and preview servers. */
function davProxy(): Plugin {
  const isLoopback = (address = '') => address === '::1' || address.replace(/^::ffff:/, '').startsWith('127.');
  const mount = (dev: boolean) => (server: { middlewares: Connect.Server }) => {
    server.middlewares.use((req, res, next) => {
      // A local CalDAV server (e.g. Radicale on 127.0.0.1) is the normal dev
      // setup, so the dev server may reach private addresses - but only for
      // requests from this machine, in case it is started with --host. The
      // per-request log line would drown the dev server's own output.
      const options = dev ? { allowPrivate: isLoopback(req.socket.remoteAddress) || undefined, log: false as const } : {};
      handleDavProxy(req, res, options)
        .then((handled: boolean) => {
          if (!handled) next();
        })
        .catch(next);
    });
  };
  return {
    name: 'calendar-dav-proxy',
    configureServer: mount(true),
    configurePreviewServer: mount(false),
  };
}

/**
 * Puts the server's Content-Security-Policy into index.html, so a bundle that
 * no server sends headers for (the Android app) is covered too. Builds only:
 * the dev server needs inline scripts for hot reloading. The tag goes first
 * in <head>, ahead of everything it has to govern; a build that cannot place
 * it fails instead of shipping without a policy.
 */
function cspMeta(policy: string): Plugin {
  return {
    name: 'calendar-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      if (/["<>&]/.test(policy) || !html.includes('<head>')) throw new Error('Cannot put the Content-Security-Policy into index.html');
      return html.replace('<head>', () => `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

/**
 * `main.tsx` loads the app itself only once the page may run it (one copy per
 * browser, see src/lib/instance.ts), so the app is a chunk of its own that
 * index.html would not name. Named there as `modulepreload` (fetched, not
 * run), with the chunks it needs, it comes as early as before, and the
 * service worker keeps it for starts without a network like the rest of the
 * shell. A build where the app is no chunk of its own (something loads it
 * before the claim) fails here.
 */
function preloadApp(): Plugin {
  return {
    name: 'calendar-preload-app',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return;
        const app = Object.values(bundle).find((c) => c.type === 'chunk' && c.isDynamicEntry && /[\\/]src[\\/]App\.tsx$/.test(c.facadeModuleId ?? ''));
        if (!app) throw new Error('src/App.tsx is not loaded on its own: it must load only after the instance claim in main.tsx');
        const files = new Set<string>();
        const add = (fileName: string) => {
          const chunk = bundle[fileName];
          if (files.has(fileName) || chunk?.type !== 'chunk') return;
          files.add(fileName);
          chunk.imports.forEach(add);
        };
        add(app.fileName);
        return [...files]
          .filter((file) => !html.includes(`"/${file}"`))
          .map((file) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `/${file}` }, injectTo: 'head' as const }));
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  // .env files count as well as the environment, like for `import.meta.env`.
  const env = loadEnv(mode, root, 'VITE_');
  const config = resolvePublicConfig(env);

  return {
    plugins: [
      react(),
      tailwindcss(),
      davProxy(),
      cspMeta(contentSecurityPolicy({ meta: true })),
      preloadApp(),
      serviceWorkerVersion(pkg.version),
      licenseFile(),
      developmentGuard(),
    ],
    // Vitest turns these into globals, so code under test sees them too.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_URL__: JSON.stringify(config.appUrl),
      __APP_LINKS__: JSON.stringify(resolveLinks(env)),
    },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // Bound to localhost by default; use `npm run dev -- --host` to test from
    // another device on a network you trust.
    server: { port: 5173 },
    // The preview answers like production, so a policy that breaks the app
    // shows before a release. No HSTS: a browser that saw it on a trusted
    // local certificate would refuse plain http://localhost from then on.
    preview: { headers: securityHeaders({ hsts: false }) },
    build: {
      chunkSizeWarningLimit: 1200,
    },
    // Workers are loaded as modules (`new Worker(url, { type: 'module' })`);
    // the default classic format cannot hold a worker that imports chunks.
    worker: { format: 'es' },
    test: {
      environment: 'node',
      env: { TZ: 'Europe/Warsaw' },
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
    },
  };
});
