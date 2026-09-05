/*
 * Static checks on the paths that only fail once the app is on a phone.
 *
 * WebViewAssetLoader strips the registered path-handler prefix from the URL and
 * treats what is left as a path under assets/. Get that wrong and the app still
 * compiles, installs and launches — it just shows ERR_INVALID_RESPONSE, because
 * AssetsPathHandler answers a missing asset with an empty WebResourceResponse.
 * The same is true of the service worker's precache list: a stale entry there
 * only shows up as a failed install at runtime.
 *
 * Run: node scripts/check-asset-paths.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const ACTIVITY = path.join(ROOT, 'android/app/src/main/java/com/levi/dashboard/MainActivity.kt');
const WEB = path.join(ROOT, 'web');

let failures = 0;
const pass = (msg, extra = '') => console.log('PASS  ' + msg + (extra ? '\n      ' + extra : ''));
const fail = (msg, extra = '') => { console.log('FAIL  ' + msg + (extra ? '\n      ' + extra : '')); failures++; };

/* ---------- the Android shell's asset URL ---------- */

const kotlin = fs.readFileSync(ACTIVITY, 'utf8');

/* Collect `const val NAME = "value"` so the checks follow constants rather than
   only string literals, then resolve "$NAME" / "${NAME}" inside those values. */
const constants = new Map(
  [...kotlin.matchAll(/const val\s+(\w+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2]])
);

function expand(value, depth = 0) {
  if (depth > 5) return value;
  const next = value.replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, braced, bare) => {
    const name = braced || bare;
    return constants.has(name) ? constants.get(name) : whole;
  });
  return next === value ? value : expand(next, depth + 1);
}

/* A handler argument is either a quoted path or the name of one of those constants. */
const handlerMatches = [...kotlin.matchAll(/addPathHandler\(\s*(?:"([^"]+)"|(\w+))/g)]
  .map(m => (m[1] !== undefined ? m[1] : constants.get(m[2])))
  .filter(Boolean)
  .map(v => expand(v));

const domain = constants.has('ASSET_DOMAIN') ? expand(constants.get('ASSET_DOMAIN')) : null;
const rawUrl = constants.has('BUNDLED_URL') ? constants.get('BUNDLED_URL') : null;

if (!domain) fail('MainActivity declares ASSET_DOMAIN');
if (!rawUrl) fail('MainActivity declares BUNDLED_URL');
if (!handlerMatches.length) fail('MainActivity registers at least one path handler');

if (domain && rawUrl && handlerMatches.length) {
  const bundledUrl = expand(rawUrl);

  let url;
  try { url = new URL(bundledUrl); } catch { url = null; }

  if (!url) {
    fail('BUNDLED_URL is a valid URL', bundledUrl);
  } else {
    if (url.host === domain) pass('BUNDLED_URL points at the asset-loader domain', url.host);
    else fail('BUNDLED_URL points at the asset-loader domain', `${url.host} !== ${domain}`);

    if (url.protocol === 'https:') pass('BUNDLED_URL is https, so the page gets a secure origin');
    else fail('BUNDLED_URL is https, so the page gets a secure origin', url.protocol);

    /* Longest registered prefix wins, mirroring PathMatcher.match(). */
    const prefix = handlerMatches
      .filter(p => url.pathname.startsWith(p))
      .sort((a, b) => b.length - a.length)[0];

    if (!prefix) {
      fail('BUNDLED_URL is covered by a registered path handler',
        `${url.pathname} matches none of: ${handlerMatches.join(', ')}`);
    } else {
      /* WebViewAssetLoader: getSuffixPath() strips the prefix, and the
         remainder is opened relative to assets/. */
      const assetPath = url.pathname.replace(prefix, '');
      const inRepo = path.join(ROOT, assetPath);

      if (!assetPath.startsWith('web/')) {
        fail('the asset path resolves inside the bundled web app',
          `handler "${prefix}" + "${url.pathname}" -> assets/${assetPath}, which is outside assets/web/`);
      } else if (!fs.existsSync(inRepo)) {
        fail('the file the app loads exists',
          `handler "${prefix}" + "${url.pathname}" -> assets/${assetPath}, but ${assetPath} is not in the repo`);
      } else {
        pass('the app loads a file that exists',
          `handler "${prefix}" + "${url.pathname}" -> assets/${assetPath}`);
      }
    }
  }
}

/* ---------- the service worker's precache list ---------- */

const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
const shellMatch = sw.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/);

if (!shellMatch) {
  fail('sw.js declares a SHELL precache list');
} else {
  const entries = [...shellMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const missing = entries
    .filter(e => e !== './')
    .filter(e => !fs.existsSync(path.join(WEB, e.replace(/^\.\//, ''))));

  if (missing.length) fail('every precached file exists', missing.join(', '));
  else pass(`every precached file exists (${entries.length} entries)`);

  /* A source that ships but is never precached silently loses offline support. */
  const sources = fs.readdirSync(path.join(WEB, 'js/sources')).filter(f => f.endsWith('.js'));
  const notCached = sources.filter(f => !entries.includes(`./js/sources/${f}`));
  if (notCached.length) fail('every card source is precached', notCached.join(', '));
  else pass(`every card source is precached (${sources.length} sources)`);
}

console.log(`\n${failures ? failures + ' FAILED' : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
