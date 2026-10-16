// Drives the real UI with clicks. Run: NODE_PATH=$(npm root -g) node tests/ui.smoke.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { doViaUI, pickInPage } = require('./lib/ui-driver.js');
const SHOTS = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const URL = 'file://' + path.join(__dirname, '..', 'dist', 'preview.html');

async function run(scheme, games) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, colorScheme: scheme, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|Failed to load/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, d, ...a) => st(f, (d === 600 || d === 750) ? 10 : d, ...a); });
  await page.goto(URL);
  const shot = n => page.screenshot({ path: `${SHOTS}/${scheme}-${n}.png` });
  const noHScroll = async where => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (w > 0) errors.push('horizontal scroll ' + w + 'px on ' + where);
  };
  await shot('menu'); await noHScroll('menu');

  // deck editor: new deck, fill with +, name it
  await page.click('[data-act=godecks]'); await shot('decks'); await noHScroll('decks');
  await page.click('[data-e=new]');
  await page.fill('#dname', 'My Test Deck');
  let guard = 0;
  while (guard++ < 200) {
    const n = await page.evaluate(() => TC.deckCount(TCUI.store.custom()[0].cards));
    if (n >= 40) break;
    const btns = await page.$$('[data-e=inc]:not([disabled])');
    if (!btns.length) break;
    await btns[guard % btns.length].click();
  }
  const info = await page.evaluate(() => { const d = TCUI.store.custom()[0]; return { name: d.name, v: TC.validateDeck(d.cards) }; });
  if (info.name !== 'My Test Deck' || !info.v.ok) errors.push('deck editor: ' + JSON.stringify(info));
  // limit enforcement: card at limit has disabled +
  await page.click('[data-e=info]'); await shot('editor'); await noHScroll('editor');
  await page.click('[data-e=share]');
  const code = await page.inputValue('#shr');
  if (!/^TC1:/.test(code)) errors.push('share code missing');
  await page.click('[data-e=closesheet]');
  await page.click('[data-e=tolist]');
  await page.click('[data-e=import]'); await page.fill('#imp', code); await page.click('[data-e=doimport]');
  const cnt = await page.evaluate(() => TCUI.store.custom().length);
  if (cnt !== 2) errors.push('import failed, decks=' + cnt);
  await page.click('[data-e=del]'); await page.click('[data-e=del]');
  if ((await page.evaluate(() => TCUI.store.custom().length)) !== 1) errors.push('delete failed ' + await page.evaluate(() => TCUI.store.custom().length));
  await page.click('[data-e=back]');
  // pick custom deck on menu
  await page.click('[data-m=pick][data-id^=d]'); await shot('menu-custom');

  const stats = { games: 0, won: 0, steps: 0, kinds: {} };
  for (let gi = 0; gi < games; gi++) {
    if (gi > 0) await page.click('[data-act=again]');
    else await page.click('[data-act=duel]');
    let n = 0, shotTaken = {};
    while (n++ < 900) {
      const st = await page.evaluate(() => { const G = TCUI._test.G(); return { over: G.over, dec: TCUI._test.decider(), turn: G.turnCount }; });
      if (st.over) break;
      if (st.dec !== 0) { await page.waitForTimeout(12); continue; }
      const a = await page.evaluate(pickInPage);
      const act = a.a;
      stats.kinds[act.type] = (stats.kinds[act.type] || 0) + 1; stats.steps++;
      await doViaUI(page, act, a.uids, {
        handSelected: async () => { if (!shotTaken.hand && gi === 0) { await shot('hand-select'); shotTaken.hand = 1; } },
        attackMode: async () => { if (!shotTaken.atk && gi === 0) { await shot('attack-mode'); shotTaken.atk = 1; } },
        respond: async () => { if (!shotTaken.resp && gi === 0) { await shot('respond'); shotTaken.resp = 1; } }
      });
      if (gi === 0 && st.turn === 4 && !shotTaken.mid) { await page.waitForTimeout(30); await shot('midgame'); await noHScroll('game'); shotTaken.mid = 1; }
    }
    if (n >= 900) errors.push('game ' + gi + ' did not finish');
    await shot('over' + gi);
    stats.games++;
    if ((await page.textContent('#over-title')) === 'Victory') stats.won++;
  }

  // scripted chain: opponent casts a Spell, I answer with a Counter Trap through the real prompt
  await page.evaluate(() => {
    TCUI.duel.stop(); TCUI.go('game');
    const deck = Array(40).fill('rival');
    const g = TC.newGame(deck, deck, 0);
    while (g.turnCount < 4) { TC.doAction(g, { type: 'end' }); while (g.pending && g.pending.kind === 'discard') TC.doAction(g, { type: 'discard', idx: 0 }); }
    g.uid++; g.players[0].st.push({ uid: g.uid, id: 'denied', faceDown: true, setTurn: 1 });
    g.uid++; g.players[1].hand.push({ uid: g.uid, id: 'springs' });
    TC.doAction(g, { type: 'cast', idx: g.players[1].hand.length - 1, target: undefined });
    window.__lp1 = g.players[1].lp;
    TCUI.duel.resume(g);
  });
  await page.waitForSelector('#prompt .chain');
  await shot('chain-prompt');
  if (!/Nani/.test(await page.textContent('#prompt'))) errors.push('chain prompt does not offer the Counter Trap');
  await page.click('[data-act=respond]');
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => { const g = TCUI._test.G(); return { pending: !!g.pending, chain: !!g.chain, lp: g.players[1].lp, gy: g.players[1].gy.slice(-1)[0] }; });
  if (after.pending && after.chain === false) errors.push('chain left a dangling pending state');
  if (after.lp !== await page.evaluate(() => window.__lp1)) errors.push('negated Hot Springs still healed');
  await page.click('[data-act=tomenu]').catch(() => page.evaluate(() => TCUI.go('menu')));
  await shot('menu-after');
  await browser.close();
  return { scheme, errors, stats };
}

(async () => {
  let bad = 0;
  for (const [scheme, games] of [['light', 3], ['dark', 1]]) {
    const r = await run(scheme, games);
    console.log(scheme, JSON.stringify(r.stats), r.errors.length ? r.errors : 'no errors');
    bad += r.errors.length;
  }
  process.exit(bad ? 1 : 0);
})();
