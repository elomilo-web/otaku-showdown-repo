// Two real browser pages play a full duel against each other over a WebRTC data channel, using only clicks.
// Run: NODE_PATH=$(npm root -g) node tests/online.smoke.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { doViaUI, pickInPage } = require('./lib/ui-driver.js');
const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const URL = 'file://' + path.join(__dirname, '..', 'dist', 'preview.html');

(async () => {
  const errors = [];
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  async function open(name, deckId) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|Failed to load/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await page.addInitScript(() => { window.__noIce = true; });
    await page.goto(URL);
    await page.evaluate(() => { TCUI.onlineIce = { iceServers: [] }; });
    await page.click('[data-act=goonline]');
    await page.fill('#oname', name);
    if (deckId) await page.evaluate(id => TCUI.store.select(id), deckId);
    return page;
  }
  const host = await open('Hana', 'preset:rush');
  const guest = await open('Yuki', 'preset:dark');
  await host.screenshot({ path: SHOTS + '/online-home.png' });

  // --- trade codes through the real screen
  await host.click('[data-o=host]');
  await host.waitForFunction(() => { const t = document.querySelector('#ocode'); return t && /^OS1o:/.test(t.value); }, null, { timeout: 15000 });
  const invite = await host.inputValue('#ocode');
  await host.screenshot({ path: SHOTS + '/online-host.png' });
  await guest.click('[data-o=join]');
  // a wrong code is explained, not a crash
  await guest.fill('#oinvite', 'hello'); await guest.click('[data-o=makereply]');
  await guest.waitForSelector('[role=alert]');
  await guest.fill('#oinvite', invite); await guest.click('[data-o=makereply]');
  await guest.waitForFunction(() => { const t = document.querySelector('#oreplycode'); return t && /^OS1a:/.test(t.value); }, null, { timeout: 15000 });
  const reply = await guest.inputValue('#oreplycode');
  await guest.screenshot({ path: SHOTS + '/online-guest.png' });
  console.log('invite code', invite.length, 'chars; reply code', reply.length, 'chars');
  await host.fill('#oreply', reply); await host.click('[data-o=connect]');

  await host.waitForFunction(() => TCUI._test.G(), null, { timeout: 20000 });
  await guest.waitForFunction(() => TCUI._test.G(), null, { timeout: 20000 });
  const seats = await Promise.all([host, guest].map(p => p.evaluate(() => ({ me: TCUI._test.me(), foe: TCUI._test.G().foeName, first: TCUI._test.G().first }))));
  if (seats[0].me !== 0 || seats[1].me !== 1) errors.push('seats wrong ' + JSON.stringify(seats));
  if (seats[0].foe !== 'Yuki' || seats[1].foe !== 'Hana') errors.push('names wrong ' + JSON.stringify(seats));
  if (seats[0].first !== seats[1].first) errors.push('different first player');

  // --- play the whole duel by clicking, each page acting only on its own decisions
  const kinds = {};
  let steps = 0, shotTurn = false;
  async function state(p) { return p.evaluate(() => { const G = TCUI._test.G(); return { over: G.over, mine: TCUI._test.mine(), turn: G.turnCount, reason: G.reason }; }); }
  while (steps < 2500) {
    const [sh, sg] = await Promise.all([state(host), state(guest)]);
    if (sh.over && sg.over) break;
    const actor = sh.mine ? host : (sg.mine ? guest : null);
    if (!actor) { await host.waitForTimeout(15); steps++; continue; }
    const pick = await actor.evaluate(pickInPage);
    kinds[pick.a.type] = (kinds[pick.a.type] || 0) + 1;
    await doViaUI(actor, pick.a, pick.uids);
    if (!shotTurn && sh.turn >= 5) { await guest.waitForTimeout(40); await guest.screenshot({ path: SHOTS + '/online-guest-duel.png' }); await host.screenshot({ path: SHOTS + '/online-host-duel.png' }); shotTurn = true; }
    steps++;
  }
  await host.waitForTimeout(100);
  const end = await Promise.all([host, guest].map(p => p.evaluate(() => { const G = TCUI._test.G(); return { over: G.over, winner: G.winner, me: TCUI._test.me(), reason: G.reason, hash: TCUI._test.hash(), title: document.querySelector('#over-title').textContent, lp: G.players.map(x => x.lp) }; })));
  console.log('moves', kinds, JSON.stringify(end));
  if (!end[0].over || !end[1].over) errors.push('duel did not finish');
  if (end[0].reason === 'desync' || end[1].reason === 'desync') errors.push('DESYNC detected');
  if (end[0].hash !== end[1].hash) errors.push('final states differ');
  if (JSON.stringify(end[0].lp) !== JSON.stringify(end[1].lp)) errors.push('LP differ');
  if (end[0].winner !== end[1].winner) errors.push('winner differs');
  const t0 = end[0].title, t1 = end[1].title;
  if (!((t0 === 'Victory' && t1 === 'Defeat') || (t0 === 'Defeat' && t1 === 'Victory') || (t0 === 'Draw' && t1 === 'Draw'))) errors.push('end titles ' + t0 + '/' + t1);
  await host.screenshot({ path: SHOTS + '/online-over.png' });

  // --- rematch: both press Rematch, a new seeded game starts on both
  await host.click('#over [data-act=again]');
  await guest.waitForFunction(() => /rematch/i.test(document.querySelector('#over-sub').textContent));
  await guest.click('#over [data-act=again]');
  await host.waitForFunction(() => { const G = TCUI._test.G(); return G && !G.over && G.turnCount === 1; }, null, { timeout: 10000 });
  await guest.waitForFunction(() => { const G = TCUI._test.G(); return G && !G.over && G.turnCount === 1; }, null, { timeout: 10000 });
  const h2 = await Promise.all([host, guest].map(p => p.evaluate(() => TCUI._test.hash())));
  if (h2[0] !== h2[1]) errors.push('rematch started in different states');

  // --- leaving counts as a loss for the leaver and a win for the other
  await guest.click('[data-act=quit]'); await guest.click('[data-act=quit]');
  await host.waitForFunction(() => TCUI._test.G().over, null, { timeout: 5000 });
  const left = await host.evaluate(() => ({ title: document.querySelector('#over-title').textContent, sub: document.querySelector('#over-sub').textContent }));
  if (left.title !== 'Victory') errors.push('host should win when the guest leaves: ' + JSON.stringify(left));

  await browser.close();
  console.log(errors.length ? errors : 'online: no errors');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
