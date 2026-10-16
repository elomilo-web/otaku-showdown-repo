// Plays one engine action through the real screen with clicks (shared by the solo and online tests).
// handUids = uids of my hand at the moment the action was chosen (actions refer to hand cards by index).
async function doViaUI(page, act, handUids, hooks) {
  const h = hooks || {};
  const cuid = act.idx !== undefined ? handUids[act.idx] : null;
  switch (act.type) {
    case 'summon': case 'set':
      await page.click(`[data-cuid="${cuid}"]`);
      if (h.handSelected) await h.handSelected();
      await page.click(`[data-act="${act.type}"]`);
      for (const t of act.tributes || []) await page.click(`[data-uid="${t}"][data-side="0"]`);
      break;
    case 'cast':
      await page.click(`[data-cuid="${cuid}"]`); await page.click('[data-act=cast]');
      if (act.target !== undefined) await page.click(`[data-uid="${act.target}"]`);
      break;
    case 'castSet':
      await page.click(`[data-stuid="${act.uid}"]`); await page.click('[data-act=castset]');
      if (act.target !== undefined) await page.click(`[data-uid="${act.target}"]`);
      break;
    case 'flip': await page.click(`[data-uid="${act.uid}"]`); await page.click('[data-act=flipsum]'); break;
    case 'pos': await page.click(`[data-uid="${act.uid}"]`); await page.click('[data-act=pos]'); break;
    case 'attack':
      await page.click(`[data-uid="${act.uid}"]`);
      if (h.attackMode) await h.attackMode();
      if (act.target.type === 'direct') await page.click('#bar-1'); else await page.click(`[data-uid="${act.target.uid}"]`);
      break;
    case 'phase': await page.click(`[data-act="phase-${act.to}"]`); break;
    case 'end': await page.click('[data-act=end]'); break;
    case 'respond':
      if (act.uid === null || act.uid === undefined) await page.click('[data-act=pass]');
      else {
        if (h.respond) await h.respond();
        await page.click(`[data-act=respond][data-ruid="${act.uid}"]` + (act.target !== undefined ? `[data-rtgt="${act.target}"]` : ''));
      }
      break;
    case 'discard': await page.click(`[data-cuid="${cuid}"]`); await page.click('[data-act=discard]'); break;
    default: throw new Error('unmapped action ' + act.type);
  }
}
// Ask the page's AI which action the current decider should take. The AI jitter uses TC.rand, which online duels
// seed, so the call swaps in Math.random for the moment (otherwise it would shift the shared random stream).
function pickInPage() {
  const G = TCUI._test.G();
  const r = TC.rand; TC.rand = Math.random;
  let a; try { a = TC.aiStep(G); } finally { TC.rand = r; }
  return { a, uids: G.players[TCUI._test.me()].hand.map(c => c.uid) };
}
module.exports = { doViaUI, pickInPage };
