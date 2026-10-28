const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
const base = 'https://example.com/babyface-koryo-signage/';
const name = 'babyface-koryo-2026-10-28-v2';
function setup() {
  const handlers = {}, stores = new Map(), requests = [], navigated = [];
  let network = async url => new Response(String(url), { headers: { 'Content-Type': String(url).endsWith('.mp4') ? 'video/mp4' : 'text/plain' } });
  let skipped = false, claimed = false, quota = false;
  const key = r => typeof r === 'string' ? r : r.url;
  const caches = {
    async open(n) {
      if (!stores.has(n)) stores.set(n, new Map());
      const store = stores.get(n);
      return {
        async put(k, v) { if (quota) throw Error('quota'); store.set(key(k), v.clone()); },
        async match(k) { return store.get(key(k))?.clone(); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); }
  };
  const clients = [base, 'https://example.com/other/', 'https://elsewhere.com/babyface-koryo-signage/'].map(url => ({url, async navigate(u) { navigated.push(u); }}));
  const context = vm.createContext({
    URL, Response, Request, AbortController, setTimeout, clearTimeout,
    console: { warn() {} }, caches,
    fetch: async (r, options) => { requests.push([key(r), options]); return network(key(r), options); },
    self: { registration: { scope: base }, addEventListener: (k, fn) => handlers[k] = fn,
      async skipWaiting() { skipped = true; }, clients: {
        async claim() { claimed = true; }, async matchAll() { return clients; }
      }
    }
  });
  vm.runInContext(source, context);
  return { stores, caches, requests, navigated,
    setNetwork(fn) { network = fn; }, setQuota() { quota = true; },
    get skipped() { return skipped; }, get claimed() { return claimed; },
    async dispatch(type) { let p; handlers[type]({waitUntil(v) { p = v; }}); await p; },
    async fetch(file, options = {}) {
      const request = { url: file.startsWith('http') ? file : base + file, method: 'GET', mode: 'cors', headers: new Headers(), ...options };
      let p; handlers.fetch({request, respondWith(v) {p = v;}}); return p && await p;
    }
  };
}
test('all precached resources exist, including seasonal/menu assets', async () => {
  const s = setup(); await s.dispatch('install'); assert.equal(s.skipped, true);
  for (const [url, options] of s.requests) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', new URL(url).pathname.split('/').pop())), url);
    assert.equal(options.cache, 'reload');
  }
  assert.ok(s.requests.some(([url]) => url.endsWith('seasonal-shrimp-2026.jpg')));
});
test('media 404 permits install; core 404 keeps current worker', async () => {
  const s = setup(); s.setNetwork(async u => new Response('data', {status: u.endsWith('food.png') ? 404 : 200}));
  await s.dispatch('install'); assert.equal(s.skipped, true);
  const broken = setup(); broken.setNetwork(async u => new Response('data', {status: u.endsWith('index.html') ? 404 : 200}));
  await assert.rejects(broken.dispatch('install')); assert.equal(broken.skipped, false);
});
test('activate removes only owned old caches and navigates only own pages', async () => {
  const s = setup();
  for (const n of ['babyface-koryo-final-v1', 'other-cache', name]) await s.caches.open(n);
  await s.dispatch('activate');
  assert.deepEqual(await s.caches.keys(), ['other-cache', name]);
  assert.equal(s.claimed, true); assert.deepEqual(s.navigated, [base]);
});
test('HTML and same-name images refresh online, use new cache offline/404', async () => {
  const s = setup(); await s.dispatch('install');
  s.setNetwork(async () => new Response('LATEST'));
  assert.equal(await (await s.fetch('?launch=1', {mode:'navigate'})).text(), 'LATEST');
  assert.equal(await (await s.fetch('payment.png')).text(), 'LATEST');
  assert.equal(s.requests.at(-1)[1].cache, 'no-cache');
  s.setNetwork(async () => { throw Error('offline'); });
  assert.equal(await (await s.fetch('', {mode:'navigate'})).text(), 'LATEST');
  assert.equal(await (await s.fetch('payment.png')).text(), 'LATEST');
  s.setNetwork(async () => new Response('404', {status:404}));
  assert.equal(await (await s.fetch('payment.png')).text(), 'LATEST');
});
test('quota failure does not discard network response; external/POST requests bypass', async () => {
  const s = setup(); s.setQuota(); s.setNetwork(async () => new Response('fresh'));
  assert.equal(await (await s.fetch('index.html')).text(), 'fresh');
  assert.equal(await s.fetch('https://api.open-meteo.com/v1/forecast'), undefined);
  assert.equal(await s.fetch('food.png', {method:'POST'}), undefined);
  assert.equal(await s.fetch('https://example.com/other/index.html'), undefined);
});
test('cached video supports full, bounded, suffix and invalid byte ranges offline', async () => {
  const s = setup(); const c = await s.caches.open(name);
  await c.put(base + 'instagram.mp4', new Response('0123456789', {headers:{'Content-Type':'video/mp4'}}));
  s.setNetwork(async () => { throw Error('offline'); });
  assert.equal(await (await s.fetch('instagram.mp4')).text(), '0123456789');
  for (const [range, body] of [['bytes=0-2','012'], ['bytes=8-','89'], ['bytes=-2','89']]) {
    const r = await s.fetch('instagram.mp4', {headers:new Headers({Range:range})});
    assert.equal(r.status,206); assert.equal(await r.text(),body);
  }
  assert.equal((await s.fetch('instagram.mp4', {headers:new Headers({Range:'bytes=99-'})})).status,416);
});
test('display code unchanged and November 1 JST boundary / drink date preserved', () => {
  const { execFileSync } = require('node:child_process');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const old = execFileSync('git', ['show', '09817fb:index.html'], {cwd:path.join(__dirname,'..'),encoding:'utf8'});
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(script.startsWith(old.match(/<script>([\s\S]*?)<\/script>/)[1].trimEnd()));
  new Function(script);
  const slidesCode = script.slice(script.indexOf('const baseSlides'), script.indexOf('let currentSlide'));
  const context = vm.createContext({Date});
  vm.runInContext(slidesCode, context);
  const slides = iso => vm.runInContext(`getSlides(new Date('${iso}'))`, context);
  const before = slides('2026-10-31T23:59:59+09:00');
  const after = slides('2026-11-01T00:00:00+09:00');
  assert.ok(before.includes('halloween-2026.png') && before.includes('koryo.png'));
  assert.ok(!after.includes('halloween-2026.png') && !after.includes('koryo.png'));
  assert.ok(after.includes('seasonal-shrimp-2026.jpg'));
  // Existing drink-date logic uses the device timezone; tests run with TZ=Asia/Tokyo.
  assert.ok(slides('2026-11-20T12:00:00+09:00').includes('drink.png'));
  assert.ok(!slides('2026-11-19T12:00:00+09:00').includes('drink.png'));
});
