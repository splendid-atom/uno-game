const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const dependencies = path.join(root, '.browser-qa', 'node_modules');
if (process.argv.includes('--prepare')) {
  fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
  for (const [source, destination] of [['dist/peerjs.min.js', 'peerjs-1.5.5.min.js'], ['LICENSE', 'peerjs-LICENSE']]) {
    const data = fs.readFileSync(path.join(dependencies, 'peerjs', source));
    assert.deepEqual(fs.readFileSync(path.join(root, 'vendor', destination)), data, 'Bundled PeerJS must match the pinned npm release');
    console.log('Verified vendor/' + destination);
  }
  process.exit(0);
}
const { chromium, webkit, devices } = require(path.join(dependencies, 'playwright'));
const { PeerServer } = require(path.join(dependencies, 'peer'));
const http = require('node:http');
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };
  try { res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'text/plain') + '; charset=utf-8' }); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
let signalServer;
const browsers = [];
async function context(browser, options = {}) {
  const ctx = await browser.newContext(options);
  ctx.setDefaultTimeout(20000);
  // Block CDNs to prove mobile joining works with only the same-origin bundle.
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort();
    return route.continue();
  });
  await ctx.addInitScript(() => {
    let PeerClass;
    Object.defineProperty(window, 'Peer', {
      configurable: true,
      get: () => PeerClass,
      set: RealPeer => {
        PeerClass = class extends RealPeer {
          constructor(id, options) {
            super(id, { ...options, host: '127.0.0.1', port: 9000, path: '/', secure: false, config: { iceServers: [] } });
          }
        };
      },
    });
  });
  return ctx;
}
async function check(label, mobileBrowser, device) {
  const hostContext = await context(browsers[0], { viewport: { width: 1280, height: 900 } });
  const mobileContext = await context(mobileBrowser, device);
  const host = await hostContext.newPage(), guest = await mobileContext.newPage();
  const errors = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  try {
    await host.goto('http://127.0.0.1:8000/');
    await host.locator('#hostButton').click();
    await host.locator('#lobbyScreen').waitFor({ state: 'visible', timeout: 30000 });
    const code = await host.locator('#roomCode').textContent();
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    await guest.goto('http://127.0.0.1:8000/?room=' + code);
    await guest.locator('#joinButton').click();
    await guest.locator('#lobbyScreen').waitFor({ state: 'visible', timeout: 75000 });
    await host.waitForFunction(() => !document.getElementById('startGameButton').disabled);
    await guest.screenshot({ path: `browser-results/${label}-lobby.png`, fullPage: true });
    await host.locator('#fillBots').uncheck();
    await host.locator('#startGameButton').click();
    await guest.locator('#gameScreen').waitFor({ state: 'visible' });
    assert.equal(await guest.locator('#playerHand button').count(), 7);
    const initialLog = await guest.locator('#gameLog').textContent();
    assert.equal(await guest.locator('#opponents .opponent').count(), 1);
    // The host plays/draws via the real UI, and the guest sees the authoritative state.
    const playable = host.locator('#playerHand button:enabled').first();
    if (await playable.count()) {
      await playable.click();
      if (await host.locator('#colorDialog').isVisible()) await host.locator('[data-color="blue"]').click();
      if (await host.locator('#unoButton').isEnabled()) await host.locator('#unoButton').click();
    } else await host.locator('#drawButton').click();
    await guest.waitForFunction(previous => document.querySelector('#gameLog').textContent !== previous, initialLog);
    assert.deepEqual(errors, []);
    assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile horizontal overflow');
    await guest.screenshot({ path: `browser-results/${label}-table.png`, fullPage: true });
    console.log(`PASS ${label}: same-origin library, room join, real WebRTC game sync, mobile layout`);
  } catch (error) {
    console.log(`FAIL ${label}: ${error.message}`);
    console.log('HOST STATUS', await host.locator('#homeStatus').textContent());
    console.log('MOBILE STATUS', await guest.locator('#homeStatus').textContent());
    console.log('PAGE ERRORS', JSON.stringify(errors));
    await guest.screenshot({ path: `browser-results/${label}-failure.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally { await mobileContext.close(); await hostContext.close(); }
}
(async () => {
  fs.mkdirSync(path.join(root, 'browser-results'), { recursive: true });
  await new Promise(resolve => server.listen(8000, '127.0.0.1', resolve));
  await new Promise(resolve => PeerServer({ port: 9000, path: '/' }, httpServer => { signalServer = httpServer; resolve(); }));
  // Local-only CI has no STUN: expose local ICE candidates across browser engines.
  browsers.push(await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] }));
  browsers.push(await webkit.launch());
  await check('android-chrome', browsers[0], devices['Pixel 7']);
  await check('iphone-webkit', browsers[1], devices['iPhone 13']);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const browser of browsers) await browser.close();
  server.close(); signalServer?.close();
  setTimeout(() => process.exit(process.exitCode || 0), 1000);
});
