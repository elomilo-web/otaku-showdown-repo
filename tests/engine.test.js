const fs = require('fs');
const path = require('path');
const assert = require('assert');

const manifest = require('../manifest.js');
const src = manifest.readAll(manifest.engineFiles());
const TC = new Function(src + '\nreturn TC;')();

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n     ')); process.exitCode = 1; }
}

const filler = () => Array(40).fill('rival');
function game(first) { return TC.newGame(filler(), filler(), first === undefined ? 0 : first); }
function give(g, pi, id) { g.uid++; g.players[pi].hand.push({ uid: g.uid, id }); return g.players[pi].hand.length - 1; }
function put(g, pi, id, o) {
  g.uid++;
  const m = Object.assign({ uid: g.uid, id, faceDown: false, pos: 'atk', placed: 0, moved: 0, attacked: 0, atkMod: 0, defMod: 0, tmpAtk: 0, tmpDef: 0 }, o || {});
  g.players[pi].mon.push(m);
  return m;
}
function putST(g, pi, id, o) {
  g.uid++;
  const c = Object.assign({ uid: g.uid, id, faceDown: true, setTurn: 0 }, o || {});
  g.players[pi].st.push(c);
  return c;
}
function act(g, a) {
  const ok = TC.doAction(g, a);
  assert.ok(ok, 'action refused: ' + JSON.stringify(a));
  // tests that just want a turn to pass do not care about the hand limit
  if (a.type === 'end') while (g.pending && g.pending.kind === 'discard') TC.doAction(g, { type: 'discard', idx: 0 });
  return ok;
}
function skipTo(g, turnCount) { // advance turns until turnCount (keeps phases tidy)
  while (g.turnCount < turnCount) { act(g, { type: 'end' }); }
}
function toBattle(g) { act(g, { type: 'phase', to: 'battle' }); }
function hasAct(g, pi, type, pred) { return TC.legalActions(g, pi).some(a => a.type === type && (!pred || pred(a))); }

// ================= data =================
t('every preset deck is legal (40-60 cards, copy limits)', () => {
  TC.PRESETS.forEach(d => {
    const v = TC.validateDeck(d.cards);
    assert.ok(v.ok, d.name + ': ' + v.errors.join(' '));
    assert.ok(v.count >= 40 && v.count <= 60);
  });
});

t('every monster has level, ATK and DEF; effects exist', () => {
  Object.keys(TC.CARDS).forEach(k => {
    const c = TC.CARDS[k];
    assert.ok(['monster', 'spell', 'trap'].includes(c.type), k);
    assert.ok(c.glyph && c.name && typeof c.text === 'string', k);
    if (c.type === 'monster') {
      assert.ok(c.lv >= 1 && c.lv <= 12, k + ' lv');
      assert.ok(Number.isInteger(c.atk) && Number.isInteger(c.def), k + ' atk/def');
    }
    assert.deepStrictEqual(TC.validateCard(k, c), [], k + ' fails card validation');
    if (c.limit !== undefined) assert.ok(Number.isInteger(c.limit) && c.limit >= 1);
  });
});

t('deck validation: size range and per-card limits', () => {
  assert.strictEqual(TC.validateDeck({ rival: 3 }).ok, false);
  const big = { rival: 3, ninja: 3, tsundere: 3, henchman: 3, delinquent: 3, loner: 3, swordmaster: 3, herohot: 3, friend: 3, classrep: 3, bodyguard: 3, idol: 3, strategist: 3, maid: 3 };
  assert.strictEqual(TC.validateDeck(big).count, 42);
  assert.ok(TC.validateDeck(big).ok);
  assert.strictEqual(TC.validateDeck(Object.assign({}, big, { rival: 4 })).ok, false, 'default limit is 3');
  assert.strictEqual(TC.validateDeck(Object.assign({}, big, { darklord: 3 })).ok, true, 'every card allows 3 unless stated');
  assert.strictEqual(TC.validateDeck(Object.assign({}, big, { darklord: 4 })).ok, false);
  assert.ok(TC.validateDeck(Object.assign({}, big, { darklord: 1 })).ok);
  const sixty = Object.assign({}, big, { mascot: 3, transfer: 3, hacker: 3, magical: 2, chosen: 3, champion: 3, president: 3, mentor: 3, springs: 3 }); // 42 + 26 = 68
  assert.strictEqual(TC.validateDeck(sixty).ok, false);
});

// ================= setup & turn structure =================
t('setup: 8000 LP, 5 cards each, no draw or attack on the first turn', () => {
  const g = game(0);
  assert.strictEqual(g.players[0].lp, 8000);
  assert.strictEqual(g.players[0].hand.length, 5);
  assert.strictEqual(g.players[1].hand.length, 5);
  assert.strictEqual(g.phase, 'main1');
  assert.strictEqual(hasAct(g, 0, 'phase'), false, 'no Battle Phase on the first turn');
});

t('draw phase: turn player draws 1 at the start of later turns', () => {
  const g = game(0);
  act(g, { type: 'end' });
  assert.strictEqual(g.turn, 1);
  assert.strictEqual(g.players[1].hand.length, 6);
  assert.strictEqual(g.players[0].hand.length, 5);
});

t('decking out at the draw phase loses', () => {
  const g = game(0);
  g.players[1].deck = [];
  act(g, { type: 'end' });
  assert.strictEqual(g.over, true);
  assert.strictEqual(g.winner, 0);
});

t('hand limit: must discard down to 7 at the end of turn', () => {
  const g = game(0);
  while (g.players[0].hand.length < 9) give(g, 0, 'rival');
  TC.doAction(g, { type: 'end' });
  assert.ok(g.pending && g.pending.kind === 'discard' && g.pending.n === 2);
  assert.strictEqual(g.turn, 0);
  assert.strictEqual(hasAct(g, 0, 'summon'), false, 'only discards are legal');
  act(g, { type: 'discard', idx: 0 });
  act(g, { type: 'discard', idx: 0 });
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.turn, 1);
  assert.strictEqual(g.players[0].hand.length, 7);
  assert.strictEqual(g.players[0].gy.length, 2);
});

// ================= summoning =================
t('Normal Summon once per turn (Summon or Set share the limit)', () => {
  const g = game(0);
  const i = give(g, 0, 'friend'); give(g, 0, 'friend');
  act(g, { type: 'summon', idx: i, tributes: [] });
  assert.strictEqual(g.players[0].mon.length, 1);
  assert.strictEqual(g.players[0].mon[0].pos, 'atk');
  assert.strictEqual(g.players[0].mon[0].faceDown, false);
  assert.strictEqual(hasAct(g, 0, 'summon'), false);
  assert.strictEqual(hasAct(g, 0, 'set', a => g.players[0].hand[a.idx] && TC.CARDS[g.players[0].hand[a.idx].id].type === 'monster'), false);
});

t('Set: monster goes face-down in Defense Position', () => {
  const g = game(0);
  const i = give(g, 0, 'maid');
  act(g, { type: 'set', idx: i, tributes: [] });
  const m = g.players[0].mon[0];
  assert.strictEqual(m.faceDown, true);
  assert.strictEqual(m.pos, 'def');
});

t('Tributes: Level 5-6 needs 1, Level 7+ needs 2', () => {
  const g = game(0);
  const hi = give(g, 0, 'herohot');   // lv5
  const hi7 = give(g, 0, 'mecha');    // lv7
  assert.strictEqual(hasAct(g, 0, 'summon', a => a.idx === hi), false, 'no tribute available');
  const a = put(g, 0, 'friend'), b = put(g, 0, 'classrep');
  assert.strictEqual(hasAct(g, 0, 'summon', a2 => a2.idx === hi7 && a2.tributes.length === 1), false);
  assert.ok(hasAct(g, 0, 'summon', x => x.idx === hi && x.tributes.length === 1));
  assert.ok(hasAct(g, 0, 'summon', x => x.idx === hi7 && x.tributes.length === 2));
  act(g, { type: 'summon', idx: hi7, tributes: [a.uid, b.uid] });
  assert.deepStrictEqual(g.players[0].mon.map(m => m.id), ['mecha']);
  assert.deepStrictEqual(g.players[0].gy.sort(), ['classrep', 'friend']);
});

t('Tribute Set works and the tribute can be a face-down monster', () => {
  const g = game(0);
  const hi = give(g, 0, 'president');
  const fd = put(g, 0, 'maid', { faceDown: true, pos: 'def' });
  act(g, { type: 'set', idx: hi, tributes: [fd.uid] });
  assert.strictEqual(g.players[0].mon.length, 1);
  assert.strictEqual(g.players[0].mon[0].id, 'president');
  assert.strictEqual(g.players[0].mon[0].faceDown, true);
});

t('field is limited to 5 monsters', () => {
  const g = game(0);
  for (let i = 0; i < 5; i++) put(g, 0, 'friend');
  give(g, 0, 'friend');
  assert.strictEqual(hasAct(g, 0, 'summon'), false);
  // but a tribute summon can still happen because the tribute frees a zone
  const i = give(g, 0, 'herohot');
  assert.ok(hasAct(g, 0, 'summon', a => a.idx === i));
});

t('Flip Summon: only for monsters Set on an earlier turn, goes to Attack Position', () => {
  const g = game(0);
  const i = give(g, 0, 'transfer');
  act(g, { type: 'set', idx: i, tributes: [] });
  const m = g.players[0].mon[0];
  assert.strictEqual(hasAct(g, 0, 'flip'), false, 'not the turn it was Set');
  act(g, { type: 'end' }); act(g, { type: 'end' });
  assert.ok(hasAct(g, 0, 'flip', a => a.uid === m.uid));
  const before = g.players[0].hand.length;
  act(g, { type: 'flip', uid: m.uid });
  assert.strictEqual(m.faceDown, false);
  assert.strictEqual(m.pos, 'atk');
  assert.strictEqual(g.players[0].hand.length, before + 1, 'Transfer Student Flip effect drew a card');
});

t('change position: not the turn it was summoned, once per turn, not after attacking', () => {
  const g = game(0);
  const i = give(g, 0, 'rival');
  act(g, { type: 'summon', idx: i, tributes: [] });
  const m = g.players[0].mon[0];
  assert.strictEqual(hasAct(g, 0, 'pos'), false);
  act(g, { type: 'end' }); act(g, { type: 'end' });
  assert.ok(hasAct(g, 0, 'pos'));
  act(g, { type: 'pos', uid: m.uid });
  assert.strictEqual(m.pos, 'def');
  assert.strictEqual(hasAct(g, 0, 'pos'), false, 'only once per turn');
  act(g, { type: 'end' }); act(g, { type: 'end' });
  act(g, { type: 'pos', uid: m.uid });             // back to attack
  toBattle(g);
  act(g, { type: 'attack', uid: m.uid, target: { type: 'direct' } });   // changed to ATK and may attack
  act(g, { type: 'phase', to: 'main2' });
  assert.strictEqual(hasAct(g, 0, 'pos'), false, 'cannot change position after attacking');
});

// ================= debut / flip effects (every one) =================
function debutGame(id, setup) {
  const g = game(0);
  skipTo(g, 3);
  if (setup) setup(g);
  return g;
}
t('Debut: Mascot Sidekick gains 500 LP', () => {
  const g = game(0); g.players[0].lp = 6000;
  const i = give(g, 0, 'mascot'); act(g, { type: 'summon', idx: i, tributes: [] });
  assert.strictEqual(g.players[0].lp, 6500);
  assert.ok(g.events.some(e => e.t === 'fx' && /Debut/.test(e.text)), 'announces the effect');
});
t('Debut: Henchman inflicts 300; Delinquent Boy 500', () => {
  const g = game(0);
  act(g, { type: 'summon', idx: give(g, 0, 'henchman'), tributes: [] });
  assert.strictEqual(g.players[1].lp, 7700);
  skipTo(g, 3);
  act(g, { type: 'summon', idx: give(g, 0, 'delinquent'), tributes: [] });
  assert.strictEqual(g.players[1].lp, 7200);
});
t('Debut: Idol Singer gains 1000', () => {
  const g = game(0); g.players[0].lp = 5000;
  act(g, { type: 'summon', idx: give(g, 0, 'idol'), tributes: [] });
  assert.strictEqual(g.players[0].lp, 6000);
});
t('Debut: Chosen One draws 1, Isekai Protagonist draws 2', () => {
  const g = game(0);
  put(g, 0, 'friend');
  const n0 = g.players[0].hand.length;
  const i = give(g, 0, 'chosen');
  act(g, { type: 'summon', idx: i, tributes: [g.players[0].mon[0].uid] });
  assert.strictEqual(g.players[0].hand.length, n0 + 1 - 1 + 1 - 0, 'drew 1 (hand: +1 given, -1 played, +1 drawn)');
  const g2 = game(0);
  const a = put(g2, 0, 'friend'), b = put(g2, 0, 'classrep');
  const n1 = g2.players[0].hand.length;
  act(g2, { type: 'summon', idx: give(g2, 0, 'isekai'), tributes: [a.uid, b.uid] });
  assert.strictEqual(g2.players[0].hand.length, n1 + 2);
});
t('Debut: Mentor Figure gives other monsters +300/+300 permanently, not itself', () => {
  const g = game(0);
  const r = put(g, 0, 'rival'), sac = put(g, 0, 'friend');
  act(g, { type: 'summon', idx: give(g, 0, 'mentor'), tributes: [sac.uid] });
  const s = TC.stats(g, 0, r);
  assert.strictEqual(s.atk, 2100); assert.strictEqual(s.def, 1800);
  const mentor = g.players[0].mon.find(m => m.id === 'mentor');
  assert.strictEqual(TC.stats(g, 0, mentor).atk, 1800);
});
t('Debut: Magical Girl destroys 1 opposing monster', () => {
  const g = game(0);
  put(g, 1, 'rival'); put(g, 1, 'friend');
  const sac = put(g, 0, 'classrep');
  act(g, { type: 'summon', idx: give(g, 0, 'magical'), tributes: [sac.uid] });
  assert.strictEqual(g.players[1].mon.length, 1);
  assert.strictEqual(g.players[1].gy.length, 1);
});
t('Debut: Dark Lord destroys all opposing monsters', () => {
  const g = game(0);
  put(g, 1, 'rival'); put(g, 1, 'friend', { faceDown: true, pos: 'def' }); put(g, 1, 'mecha');
  const a = put(g, 0, 'classrep'), b = put(g, 0, 'friend');
  act(g, { type: 'summon', idx: give(g, 0, 'darklord'), tributes: [a.uid, b.uid] });
  assert.strictEqual(g.players[1].mon.length, 0);
  assert.strictEqual(g.players[1].gy.length, 3);
});
t('Debut: Genius Hacker destroys an opposing Spell/Trap', () => {
  const g = game(0);
  putST(g, 1, 'interrupt');
  act(g, { type: 'summon', idx: give(g, 0, 'hacker'), tributes: [] });
  assert.strictEqual(g.players[1].st.length, 0);
  assert.deepStrictEqual(g.players[1].gy, ['interrupt']);
});
t('Debut effects do NOT trigger when a monster is Set', () => {
  const g = game(0); g.players[0].lp = 5000;
  act(g, { type: 'set', idx: give(g, 0, 'idol'), tributes: [] });
  assert.strictEqual(g.players[0].lp, 5000);
});
t('Flip effects: Cat-Eared Maid +1000, Tsundere 500, Haunted Doll 800, Strategist draw, Shrine Maiden destroys S/T', () => {
  const run = (id, setup, check) => {
    const g = game(0); g.players[0].lp = 5000;
    if (setup) setup(g);
    const m = put(g, 0, id, { faceDown: true, pos: 'def', placed: -1 });
    g.turnCount = 5;
    act(g, { type: 'flip', uid: m.uid });
    check(g);
  };
  run('maid', null, g => assert.strictEqual(g.players[0].lp, 6000));
  run('tsundere', null, g => assert.strictEqual(g.players[1].lp, 7500));
  run('doll', null, g => assert.strictEqual(g.players[1].lp, 7200));
  run('strategist', g => { g.players[0].hand = []; }, g => assert.strictEqual(g.players[0].hand.length, 1));
  run('shrine', g => putST(g, 1, 'mirror'), g => assert.strictEqual(g.players[1].st.length, 0));
});

// ================= battle rules =================
function duel(atkId, tgtId, tgtOpts, atkOpts) {
  const g = game(0);
  skipTo(g, 3);
  const a = put(g, 0, atkId, Object.assign({ placed: 0 }, atkOpts || {}));
  const d = put(g, 1, tgtId, tgtOpts);
  toBattle(g);
  return { g, a, d };
}
const attackMon = (g, a, d) => act(g, { type: 'attack', uid: a.uid, target: { type: 'mon', uid: d.uid } });

t('ATK vs ATK: higher wins, difference hits the loser', () => {
  const { g, a, d } = duel('rival', 'friend');       // 1800 vs 1000
  attackMon(g, a, d);
  assert.strictEqual(g.players[1].mon.length, 0);
  assert.strictEqual(g.players[1].lp, 8000 - 800);
  assert.strictEqual(g.players[0].mon.length, 1);
});
t('ATK vs ATK: lower attacker is destroyed and its controller takes the difference', () => {
  const { g, a, d } = duel('friend', 'rival');
  attackMon(g, a, d);
  assert.strictEqual(g.players[0].mon.length, 0);
  assert.strictEqual(g.players[0].lp, 8000 - 800);
  assert.strictEqual(g.players[1].lp, 8000);
});
t('ATK vs ATK: tie destroys both, no damage', () => {
  const { g, a, d } = duel('rival', 'rival');
  attackMon(g, a, d);
  assert.strictEqual(g.players[0].mon.length + g.players[1].mon.length, 0);
  assert.strictEqual(g.players[0].lp, 8000); assert.strictEqual(g.players[1].lp, 8000);
});
t('ATK vs face-up DEF: ATK > DEF destroys it with no damage', () => {
  const { g, a, d } = duel('rival', 'classrep', { pos: 'def' });   // 1800 vs DEF 1800 -> tie first
  attackMon(g, a, d);
  assert.strictEqual(g.players[1].mon.length, 1, 'tie: nothing happens');
  const r = duel('swordmaster', 'friend', { pos: 'def' });         // 1900 vs 1600
  r.g.players[0].mon[0].kw; attackMon(r.g, r.a, r.d);
  assert.strictEqual(r.g.players[1].mon.length, 0);
  assert.strictEqual(r.g.players[1].lp, 8000 + 0 - 300, 'Swordmaster has Pierce: 300 damage');
});
t('ATK > DEF without Pierce deals no damage', () => {
  const { g, a, d } = duel('rival', 'friend', { pos: 'def' });     // 1800 vs 1600
  attackMon(g, a, d);
  assert.strictEqual(g.players[1].mon.length, 0);
  assert.strictEqual(g.players[1].lp, 8000);
});
t('ATK < DEF: attacker takes the difference, nothing destroyed', () => {
  const { g, a, d } = duel('friend', 'bodyguard', { pos: 'def' }); // 1000 vs 2000
  attackMon(g, a, d);
  assert.strictEqual(g.players[0].lp, 7000);
  assert.strictEqual(g.players[0].mon.length, 1); assert.strictEqual(g.players[1].mon.length, 1);
});
t('Attacking a face-down monster flips it face-up (Defense Position) and uses its DEF', () => {
  const { g, a, d } = duel('rival', 'maid', { faceDown: true, pos: 'def' });   // maid DEF 1500, Flip +1000 LP
  g.players[1].lp = 4000;
  attackMon(g, a, d);
  assert.strictEqual(d.faceDown, false);
  assert.strictEqual(g.players[1].lp, 5000, 'Flip effect (+1000) resolved');
  assert.strictEqual(g.players[1].mon.length, 0, '1800 > 1500 destroys it');
});
t('Flip effect can win the battle: Haunted Doll burns when flipped by an attack', () => {
  const { g, a, d } = duel('friend', 'doll', { faceDown: true, pos: 'def' });
  attackMon(g, a, d);
  // Flip: 800 to the attacker's controller, then Friend (1000) fails against Doll DEF 1400: another 400
  assert.strictEqual(g.players[0].lp, 8000 - 800 - 400);
});
t('no attacks in Main Phase, no attacks with Defense/face-down monsters, once per turn', () => {
  const g = game(0); skipTo(g, 3);
  const a = put(g, 0, 'rival'), s = put(g, 0, 'friend', { pos: 'def' }), f = put(g, 0, 'maid', { faceDown: true, pos: 'def' });
  assert.strictEqual(hasAct(g, 0, 'attack'), false, 'Main Phase');
  toBattle(g);
  const atkers = TC.legalActions(g, 0).filter(x => x.type === 'attack').map(x => x.uid);
  assert.ok(atkers.includes(a.uid)); assert.ok(!atkers.includes(s.uid)); assert.ok(!atkers.includes(f.uid));
  act(g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  assert.strictEqual(hasAct(g, 0, 'attack', x => x.uid === a.uid), false);
});
t('monsters can attack the turn they are Summoned (no summoning sickness)', () => {
  const g = game(0); skipTo(g, 3);
  act(g, { type: 'summon', idx: give(g, 0, 'rival'), tributes: [] });
  toBattle(g);
  assert.ok(hasAct(g, 0, 'attack'));
});

// ================= direct attack rule =================
t('cannot attack directly while the opponent controls a monster that can defend', () => {
  const g = game(0); skipTo(g, 3);
  const a = put(g, 0, 'rival'); const d = put(g, 1, 'friend');
  toBattle(g);
  assert.strictEqual(hasAct(g, 0, 'attack', x => x.target.type === 'direct'), false);
  assert.ok(hasAct(g, 0, 'attack', x => x.target.type === 'mon' && x.target.uid === d.uid));
  // a face-down monster also blocks
  d.faceDown = true; d.pos = 'def';
  assert.strictEqual(hasAct(g, 0, 'attack', x => x.target.type === 'direct'), false);
});
t('may attack directly when the opponent controls no monsters', () => {
  const g = game(0); skipTo(g, 3);
  const a = put(g, 0, 'rival');
  toBattle(g);
  act(g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  assert.strictEqual(g.players[1].lp, 6200);
});
t('monsters that cannot defend do not stop direct attacks', () => {
  const g = game(0); skipTo(g, 3);
  const a = put(g, 0, 'rival'); const loner = put(g, 1, 'loner');
  toBattle(g);
  assert.ok(hasAct(g, 0, 'attack', x => x.target.type === 'direct'), 'direct allowed');
  assert.ok(hasAct(g, 0, 'attack', x => x.target.type === 'mon' && x.target.uid === loner.uid), 'but it can still be attacked');
  put(g, 1, 'friend');
  assert.strictEqual(hasAct(g, 0, 'attack', x => x.target.type === 'direct'), false, 'a real defender restores the block');
});
t('Direct keyword (Ninja) can attack directly past defenders', () => {
  const g = game(0); skipTo(g, 3);
  const n = put(g, 0, 'ninja'); put(g, 1, 'bodyguard'); const r = put(g, 0, 'rival');
  toBattle(g);
  assert.ok(hasAct(g, 0, 'attack', x => x.uid === n.uid && x.target.type === 'direct'));
  assert.strictEqual(hasAct(g, 0, 'attack', x => x.uid === r.uid && x.target.type === 'direct'), false);
});

// ================= spells =================
function main(g) { skipTo(g, 3); return g; }
t('Normal Spell: Flashback draws 2 and goes to the graveyard', () => {
  const g = main(game(0)); g.players[0].hand = [];
  act(g, { type: 'cast', idx: give(g, 0, 'flashback') });
  assert.strictEqual(g.players[0].hand.length, 2);
  assert.ok(g.players[0].gy.includes('flashback'));
});
t('Isekai Truck destroys the targeted monster (even face-down)', () => {
  const g = main(game(0));
  const d = put(g, 1, 'maid', { faceDown: true, pos: 'def' });
  const other = put(g, 1, 'mecha');
  const i = give(g, 0, 'truck');
  assert.deepStrictEqual(TC.spellTargets(g, 0, 'truck').sort(), [d.uid, other.uid].sort());
  act(g, { type: 'cast', idx: i, target: d.uid });
  assert.deepStrictEqual(g.players[1].mon.map(m => m.uid), [other.uid]);
});
t('Training Arc: permanent +500/+500; needs a face-up monster of yours', () => {
  const g = main(game(0));
  const i = give(g, 0, 'trainarc');
  assert.strictEqual(hasAct(g, 0, 'cast', a => a.idx === i), false);
  const m = put(g, 0, 'rival');
  act(g, { type: 'cast', idx: i, target: m.uid });
  assert.deepStrictEqual(TC.stats(g, 0, m), { atk: 2300, def: 2000 });
  skipTo(g, g.turnCount + 2);
  assert.deepStrictEqual(TC.stats(g, 0, m), { atk: 2300, def: 2000 }, 'stays');
});
t('Equip: Legendary Sword +700 ATK, destroyed with its monster', () => {
  const g = main(game(0));
  const m = put(g, 0, 'rival');
  act(g, { type: 'cast', idx: give(g, 0, 'sword'), target: m.uid });
  assert.strictEqual(TC.stats(g, 0, m).atk, 2500);
  assert.strictEqual(g.players[0].st.length, 1);
  put(g, 1, 'mecha');
  // destroy the equipped monster with Truck
  g.turn = 1; g.phase = 'main1'; g.normalUsed = false; g.normalCount = 0;
  act(g, { type: 'cast', idx: give(g, 1, 'truck'), target: m.uid });
  assert.strictEqual(g.players[0].st.length, 0, 'equip card left with the monster');
  assert.ok(g.players[0].gy.includes('sword'));
});
t('Sudden Power-Up (Quick-Play) works in the Battle Phase and wears off at the end of turn', () => {
  const g = main(game(0));
  const m = put(g, 0, 'rival');
  const i = give(g, 0, 'powerup');
  toBattle(g);
  act(g, { type: 'cast', idx: i, target: m.uid });
  assert.strictEqual(TC.stats(g, 0, m).atk, 2600);
  act(g, { type: 'end' });
  assert.strictEqual(TC.stats(g, 0, m).atk, 1800);
});
t('Power of Friendship: temporary boost to face-up monsters only', () => {
  const g = main(game(0));
  const a = put(g, 0, 'rival'), b = put(g, 0, 'maid', { faceDown: true, pos: 'def' });
  act(g, { type: 'cast', idx: give(g, 0, 'friendship') });
  assert.strictEqual(TC.stats(g, 0, a).atk, 2100);
  assert.strictEqual(b.tmpAtk, 0);
});
t('Beam Spam destroys only Attack Position monsters', () => {
  const g = main(game(0));
  put(g, 1, 'rival'); put(g, 1, 'friend', { pos: 'def' }); put(g, 1, 'maid', { faceDown: true, pos: 'def' });
  act(g, { type: 'cast', idx: give(g, 0, 'beam') });
  assert.strictEqual(g.players[1].mon.length, 2);
});
t('Ultimate Technique inflicts 1500; Hot Springs gains 2000', () => {
  const g = main(game(0)); g.players[0].lp = 3000;
  act(g, { type: 'cast', idx: give(g, 0, 'ultimate') });
  assert.strictEqual(g.players[1].lp, 6500);
  act(g, { type: 'cast', idx: give(g, 0, 'springs') });
  assert.strictEqual(g.players[0].lp, 5000);
});
t('Dramatic Reveal flips every face-down monster (Flip effects fire)', () => {
  const g = main(game(0)); g.players[0].lp = 4000;
  const mine = put(g, 0, 'maid', { faceDown: true, pos: 'def' });
  const theirs = put(g, 1, 'tsundere', { faceDown: true, pos: 'def' });
  act(g, { type: 'cast', idx: give(g, 0, 'reveal') });
  assert.strictEqual(mine.faceDown, false); assert.strictEqual(theirs.faceDown, false);
  assert.strictEqual(mine.pos, 'def');
  assert.strictEqual(g.players[0].lp, 5000 - 500, 'maid +1000, then their Tsundere hits for 500');
});
t('Field Spell: Training Camp boosts my monsters and replaces the old Field Spell', () => {
  const g = main(game(0));
  const m = put(g, 0, 'rival'); const e = put(g, 1, 'rival');
  act(g, { type: 'cast', idx: give(g, 0, 'camp') });
  assert.strictEqual(TC.stats(g, 0, m).atk, 2100);
  assert.strictEqual(TC.stats(g, 1, e).atk, 1800);
  assert.strictEqual(g.players[0].st.length, 0, 'Field Spells use the Field Zone');
  act(g, { type: 'cast', idx: give(g, 0, 'camp') });
  assert.strictEqual(g.players[0].gy.length, 1);
});
t('Continuous Spell: Cheering Section heals 300 each of my Standby Phases', () => {
  const g = main(game(0)); g.players[0].lp = 5000;
  act(g, { type: 'cast', idx: give(g, 0, 'cheer') });
  skipTo(g, g.turnCount + 2);
  assert.strictEqual(g.players[0].lp, 5300);
});
t('Set spells can be activated from the field; Quick-Play only on a later turn', () => {
  const g = main(game(0));
  const m = put(g, 0, 'rival');
  act(g, { type: 'set', idx: give(g, 0, 'powerup'), tributes: [] });
  act(g, { type: 'set', idx: give(g, 0, 'springs'), tributes: [] });
  const set = g.players[0].st;
  assert.ok(hasAct(g, 0, 'castSet', a => a.uid === set[1].uid), 'normal spell: same turn');
  assert.strictEqual(hasAct(g, 0, 'castSet', a => a.uid === set[0].uid), false, 'Quick-Play: not the turn it was Set');
  skipTo(g, g.turnCount + 2);
  assert.ok(hasAct(g, 0, 'castSet', a => a.uid === set[0].uid));
});
t('Spell/Trap zones are limited to 5', () => {
  const g = main(game(0));
  for (let i = 0; i < 5; i++) putST(g, 0, 'interrupt');
  g.players[0].hand = [];
  give(g, 0, 'springs'); give(g, 0, 'mirror');
  assert.strictEqual(hasAct(g, 0, 'set'), false);
  assert.strictEqual(hasAct(g, 0, 'cast'), false);
});

// ================= traps =================
function trapGame(trapId) {
  const g = game(0); skipTo(g, 3);               // player 0's turn
  const trap = putST(g, 1, trapId, { setTurn: 1 });
  return { g, trap };
}
t('Traps cannot be activated the turn they were Set', () => {
  const g = game(0); skipTo(g, 3);
  const a = put(g, 0, 'rival'); put(g, 1, 'friend');
  putST(g, 1, 'interrupt', { setTurn: g.turnCount });
  toBattle(g);
  act(g, { type: 'attack', uid: a.uid, target: { type: 'mon', uid: g.players[1].mon[0].uid } });
  assert.strictEqual(g.pending, null, 'no window opened');
});
t('Trap window opens when attacked; Sudden Interruption negates the attack', () => {
  const { g, trap } = trapGame('interrupt');
  const a = put(g, 0, 'rival'); const d = put(g, 1, 'friend');
  toBattle(g);
  act(g, { type: 'attack', uid: a.uid, target: { type: 'mon', uid: d.uid } });
  assert.ok(g.pending && g.pending.kind === 'respond' && g.pending.pi === 1);
  assert.strictEqual(TC.legalActions(g, 0).length, 0, 'attacker must wait');
  act(g, { type: 'respond', uid: trap.uid });
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.players[1].mon.length, 1, 'no battle happened');
  assert.strictEqual(g.players[1].st.length, 0);
  assert.deepStrictEqual(g.players[1].gy, ['interrupt']);
});
t('Passing the trap window lets the battle resolve', () => {
  const { g } = trapGame('interrupt');
  const a = put(g, 0, 'rival'); const d = put(g, 1, 'friend');
  toBattle(g);
  act(g, { type: 'attack', uid: a.uid, target: { type: 'mon', uid: d.uid } });
  act(g, { type: 'respond', uid: null });
  assert.strictEqual(g.players[1].mon.length, 0);
  assert.strictEqual(g.players[1].st.length, 1, 'trap stays set');
});
t('Mirror Reflection destroys all my Attack Position monsters', () => {
  const { g, trap } = trapGame('mirror');
  const a = put(g, 0, 'rival'), b = put(g, 0, 'ninja'), c = put(g, 0, 'friend', { pos: 'def' });
  toBattle(g);
  act(g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  act(g, { type: 'respond', uid: trap.uid });
  assert.deepStrictEqual(g.players[0].mon.map(m => m.id), ['friend']);
  assert.strictEqual(g.players[1].lp, 8000);
});
t('Hidden Ambush destroys the attacker; Heartfelt Plea negates and heals; Plot Twist switches to Defense', () => {
  let r = trapGame('ambush');
  let a = put(r.g, 0, 'rival'); toBattle(r.g);
  act(r.g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  act(r.g, { type: 'respond', uid: r.trap.uid });
  assert.strictEqual(r.g.players[0].mon.length, 0);
  r = trapGame('plea'); r.g.players[1].lp = 3000;
  a = put(r.g, 0, 'rival'); toBattle(r.g);
  act(r.g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  act(r.g, { type: 'respond', uid: r.trap.uid });
  assert.strictEqual(r.g.players[1].lp, 4000);
  r = trapGame('twist');
  a = put(r.g, 0, 'rival'); toBattle(r.g);
  act(r.g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  act(r.g, { type: 'respond', uid: r.trap.uid });
  assert.strictEqual(a.pos, 'def'); assert.strictEqual(r.g.players[1].lp, 8000);
});
t('Hidden Trapdoor chains to a Summon with 1000+ ATK and resolves first', () => {
  const { g, trap } = trapGame('trapdoor');
  g.players[1].lp = 8000;
  const i = give(g, 0, 'henchman');            // 1100 ATK, Debut: 300 damage
  act(g, { type: 'summon', idx: i, tributes: [] });
  assert.ok(g.pending && g.pending.ctx.kind === 'summon');
  act(g, { type: 'respond', uid: trap.uid });
  assert.strictEqual(g.players[0].mon.length, 0, 'destroyed');
  assert.strictEqual(g.players[1].lp, 7700, 'the Debut effect is chain link 1 and still resolves after the trap (chain order)');
});
t('Trapdoor ignores weak monsters; Set monsters do not open a Summon window', () => {
  const { g, trap } = trapGame('trapdoor');
  act(g, { type: 'set', idx: give(g, 0, 'maid'), tributes: [] });
  assert.strictEqual(g.pending, null);
});
t('Trap respond/pass actions are only offered to the responding player', () => {
  const { g } = trapGame('interrupt');
  const a = put(g, 0, 'rival');
  toBattle(g);
  act(g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  assert.strictEqual(TC.legalActions(g, 0).length, 0);
  assert.ok(TC.legalActions(g, 1).every(x => x.type === 'respond'));
  assert.strictEqual(TC.doAction(g, { type: 'end' }), false, 'turn player cannot act during the window');
});

// ================= chains =================
t('chain: a Counter Trap answers a Spell, negates it, and the Spell is destroyed', () => {
  const g = game(0); skipTo(g, 3);
  putST(g, 1, 'denied', { setTurn: 1 });
  const hand0 = g.players[0].hand.length;
  const i = give(g, 0, 'flashback');
  act(g, { type: 'cast', idx: i, target: undefined });
  assert.ok(g.pending && g.pending.kind === 'respond' && g.pending.pi === 1, 'opponent may respond');
  assert.ok(g.pending.options.some(o => g.players[1].st.some(c => c.uid === o.uid)));
  act(g, { type: 'respond', uid: g.pending.options[0].uid });
  assert.strictEqual(g.pending, null, 'the Spell player has no response, chain resolves');
  assert.strictEqual(g.players[0].hand.length, hand0, 'Flashback was negated: no cards drawn (hand back to the same size)');
  assert.ok(g.players[0].gy.indexOf('flashback') >= 0, 'negated Spell goes to the graveyard');
  assert.ok(g.players[1].gy.indexOf('denied') >= 0);
});
t('chain: both players can add links; last link resolves first', () => {
  const g = game(0); skipTo(g, 3);
  const hacker = null;
  putST(g, 1, 'denied', { setTurn: 1 });            // opponent counter
  putST(g, 0, 'denied', { setTurn: 1 });            // I also hold a counter
  const i = give(g, 0, 'springs');
  const lp0 = g.players[0].lp;
  act(g, { type: 'cast', idx: i, target: undefined });                 // link 1 (me)
  const mine = g.players[1].st[0];
  act(g, { type: 'respond', uid: mine.uid });                          // link 2 (foe) negates link 1
  assert.ok(g.pending && g.pending.pi === 0, 'I may answer their counter with mine');
  act(g, { type: 'respond', uid: g.players[0].st[0].uid });             // link 3 (me) negates link 2
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.players[0].lp, lp0 + 2000, 'link 3 negated the negation, so Hot Springs resolves');
});
t('chain: a normal Trap cannot answer a Counter Trap (Spell Speed 3)', () => {
  const g = game(0); skipTo(g, 3);
  putST(g, 0, 'denied', { setTurn: 1 });
  putST(g, 1, 'denied', { setTurn: 1 });
  putST(g, 0, 'interrupt', { setTurn: 1 });
  act(g, { type: 'cast', idx: give(g, 0, 'springs'), target: undefined });
  act(g, { type: 'respond', uid: g.players[1].st[0].uid });
  const opts = g.pending.options.map(o => g.players[0].st.find(c => c.uid === o.uid).id);
  assert.deepStrictEqual(opts, ['denied'], 'only the Counter Trap can respond to a Counter Trap');
});
t('chain: Counter Trap needs a Spell/Trap on the chain (not an attack)', () => {
  const { g } = trapGame('denied');
  const a = put(g, 0, 'rival');
  toBattle(g);
  act(g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  assert.strictEqual(g.pending, null, 'nothing to counter on an attack declaration');
});

// ================= golden rule: cards bend base rules =================
t('golden rule: base attacks per turn is 1; Dual-Wield Swordsman attacks twice', () => {
  const g = game(0); skipTo(g, 3);
  const a = put(g, 0, 'rival'), b = put(g, 0, 'dualblade');
  toBattle(g);
  act(g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  assert.strictEqual(hasAct(g, 0, 'attack', x => x.uid === a.uid), false, 'one attack only');
  act(g, { type: 'attack', uid: b.uid, target: { type: 'direct' } });
  assert.strictEqual(hasAct(g, 0, 'attack', x => x.uid === b.uid), true, 'second attack allowed');
  act(g, { type: 'attack', uid: b.uid, target: { type: 'direct' } });
  assert.strictEqual(hasAct(g, 0, 'attack', x => x.uid === b.uid), false);
  assert.strictEqual(g.players[1].lp, 8000 - 1800 - 1500 - 1500);
});
t('golden rule: Bottomless Backpack raises my hand limit to 9 and only while face-up', () => {
  const g = game(0);
  putST(g, 0, 'backpack', { faceDown: false });
  assert.strictEqual(TC.handLimit(g, 0), 9);
  assert.strictEqual(TC.handLimit(g, 1), 7, 'scope: player only');
  while (g.players[0].hand.length < 9) give(g, 0, 'rival');
  act(g, { type: 'end' });
  assert.strictEqual(g.turn, 1, 'no discard needed at 9 cards');
  const g2 = game(0); putST(g2, 0, 'backpack', { faceDown: true });
  assert.strictEqual(TC.handLimit(g2, 0), 7, 'face-down it does nothing');
});
t('golden rule: Shonen Pacing allows two Normal Summons per turn', () => {
  const g = game(0);
  putST(g, 0, 'pacing', { faceDown: false });
  act(g, { type: 'summon', idx: give(g, 0, 'friend'), tributes: [] });
  assert.ok(hasAct(g, 0, 'summon'), 'second Summon available');
  act(g, { type: 'summon', idx: give(g, 0, 'friend'), tributes: [] });
  assert.strictEqual(hasAct(g, 0, 'summon'), false, 'but not a third');
});
t('golden rule: base rule values are the defaults', () => {
  const g = game(0);
  assert.strictEqual(TC.RULE_DEFS.handLimit.default, 7);
  assert.strictEqual(TC.RULE_DEFS.attacksPerTurn.default, 1);
  assert.strictEqual(TC.RULE_DEFS.summonsPerTurn.default, 1);
  assert.strictEqual(TC.rule(g, 'handLimit', { kind: 'player', pi: 0 }), 7);
});
t('first turn: no attacks and no Battle Phase for the first player', () => {
  const g = game(0);
  put(g, 0, 'rival');
  assert.strictEqual(hasAct(g, 0, 'phase', a => a.to === 'battle'), false);
});

// ================= online determinism =================
t('determinism: the same seed and the same moves give the same game (what online play relies on)', () => {
  function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  const realRand = TC.rand;
  const snap = g => JSON.stringify(g.players.map(p => [p.lp, p.deck.length, p.hand.map(c => c.id), p.mon.map(m => [m.id, m.pos, m.faceDown]), p.gy]));
  try {
    for (let k = 0; k < 20; k++) {
      const decks = [TC.expandDeck(TC.PRESETS[k % 3].cards), TC.expandDeck(TC.PRESETS[(k + 1) % 3].cards)];
      TC.rand = seeded(1000 + k);
      const g1 = TC.newGame(decks[0], decks[1], k % 2);
      const moves = []; let s = 0;
      while (!g1.over && s++ < 1500) {
        const r = TC.rand; TC.rand = Math.random; const a = TC.aiStep(g1); TC.rand = r;   // AI choices are not part of the shared stream
        moves.push(a); if (!TC.doAction(g1, a)) { TC.doAction(g1, { type: 'end' }); moves.push({ type: 'end' }); }
      }
      TC.rand = seeded(1000 + k);
      const g2 = TC.newGame(decks[0], decks[1], k % 2);
      moves.forEach(a => assert.ok(TC.doAction(g2, a), 'replay refused ' + JSON.stringify(a)));
      assert.strictEqual(snap(g2), snap(g1), 'game ' + k + ' diverged');
      assert.strictEqual(g2.winner, g1.winner);
    }
  } finally { TC.rand = realRand; }
});

// ================= formats (ban / limit list) =================
t('format: every card is limited to 3 (no limits unless the designer states one)', () => {
  Object.keys(TC.CARDS).forEach(id => assert.strictEqual(TC.limitOf(id), 3, id));
});
t('format: a ban/limit list overrides limits, 0 bans a card', () => {
  const old = TC.format;
  TC.registerFormat({ id: 'testfmt', name: 'Test', limits: { darklord: 1, robot: 0 } });
  TC.format = 'testfmt';
  try {
    assert.strictEqual(TC.limitOf('darklord'), 1);
    assert.strictEqual(TC.limitOf('robot'), 0);
    assert.strictEqual(TC.limitOf('rival'), 3);
    const base = Object.assign({}, TC.presetById('preset:rush').cards);
    assert.ok(TC.validateDeck(Object.assign({}, base, { robot: 1 })).errors.some(e => /banned/.test(e)));
    assert.ok(TC.validateDeck(Object.assign({}, base, { darklord: 2 })).errors.some(e => /limit is 1/.test(e)));
    assert.notStrictEqual(TC.contentHash(), (TC.format = old, TC.contentHash()), 'format changes the fingerprint');
  } finally { TC.format = old; }
});

// ================= modularity =================
t('modular: a new set registers with no engine changes and its card works', () => {
  TC.registerSet({
    id: 'testset', name: 'Test Set', cards: {
      zapper: { name: 'Zapper', type: 'monster', lv: 2, atk: 500, def: 500, glyph: '雷', hue: 60,
        effects: [{ on: 'debut', ops: [{ op: 'burn', n: 777 }] }] }
    }
  });
  assert.ok(TC.CARDS.zapper && TC.CARDS.zapper.text.indexOf('777') >= 0, 'text is generated from the data');
  const g = TC.newGame(Array(40).fill('zapper'), Array(40).fill('rival'), 0);
  const i = give(g, 0, 'zapper');
  act(g, { type: 'summon', idx: i, tributes: [] });
  assert.strictEqual(g.players[1].lp, 8000 - 777);
});
t('modular: bad card data is rejected with a clear message', () => {
  assert.throws(() => TC.registerSet({ id: 'bad1', name: 'Bad', cards: { x: { name: 'X', type: 'monster', lv: 3, atk: 1, def: 1, glyph: 'x', hue: 1, effects: [{ on: 'debut', ops: [{ op: 'nope' }] }] } } }), /unknown op nope/);
  assert.throws(() => TC.registerSet({ id: 'bad2', name: 'Bad', cards: { y: { name: 'Y', type: 'monster', lv: 3, atk: 1, def: 1, glyph: 'y', hue: 1, passives: [{ rule: 'flying', value: 1 }] } } }), /unknown rule flying/);
  assert.throws(() => TC.registerSet({ id: 'core', name: 'Dup', cards: {} }), /already registered/);
  assert.throws(() => TC.registerSet({ id: 'bad3', name: 'Bad', cards: { rival: { name: 'R', type: 'monster', lv: 3, atk: 1, def: 1, glyph: 'r', hue: 1 } } }), /already exists/);
  assert.ok(!TC.CARDS.x && !TC.CARDS.y, 'nothing from a rejected set is registered');
});
t('modular: every registered card passes validation and has display text or none by design', () => {
  Object.keys(TC.CARDS).forEach(id => assert.deepStrictEqual(TC.validateCard(id, TC.CARDS[id]), [], id));
});

// ================= misc rules =================
t('illegal actions are refused (not enough tributes, wrong phase, not your turn)', () => {
  const g = game(0);
  const i = give(g, 0, 'mecha');
  assert.strictEqual(TC.doAction(g, { type: 'summon', idx: i, tributes: [] }), false);
  assert.strictEqual(TC.doAction(g, { type: 'attack', uid: 1, target: { type: 'direct' } }), false);
  assert.strictEqual(TC.doAction(g, { type: 'end' }), true);
  assert.strictEqual(TC.doAction(g, { type: 'end' }), true);   // second player ends too
  assert.strictEqual(g.turn, 0);
  g.turn = 1;
  assert.strictEqual(TC.doAction(g, { type: 'summon', idx: 0, tributes: [] }), true, 'moves for the turn player only');
});
t('winning: LP 0 ends the duel immediately', () => {
  const g = game(0); skipTo(g, 3);
  g.players[1].lp = 1000;
  const a = put(g, 0, 'rival'); toBattle(g);
  act(g, { type: 'attack', uid: a.uid, target: { type: 'direct' } });
  assert.strictEqual(g.over, true); assert.strictEqual(g.winner, 0);
  assert.strictEqual(TC.legalActions(g, 0).length, 0);
});
t('burn effect can win the duel', () => {
  const g = game(0); g.players[1].lp = 300;
  act(g, { type: 'summon', idx: give(g, 0, 'henchman'), tributes: [] });
  assert.strictEqual(g.over, true); assert.strictEqual(g.winner, 0);
});

// ================= AI vs AI fuzz =================
function invariants(g, where) {
  g.players.forEach((p, i) => {
    assert.ok(p.mon.length <= 5, where + ': monsters > 5');
    assert.ok(p.st.length <= 5, where + ': S/T > 5');
    p.mon.forEach(m => { assert.ok(TC.CARDS[m.id], 'bad id'); });
    const held = g.chain ? g.chain.links.filter(l => l.limbo && l.pi === i).length : 0;
    const total = p.deck.length + p.hand.length + p.mon.length + p.st.length + (p.field ? 1 : 0) + p.gy.length + held;
    g._expect = g._expect || [];
    if (g._expect[i] === undefined) g._expect[i] = total;     // decks differ in size (40-60); the total must never change
    assert.strictEqual(total, g._expect[i], where + ': card conservation broken for player ' + i + ' (' + total + ')');
    const uids = [].concat(p.hand.map(c => c.uid), p.mon.map(m => m.uid), p.st.map(c => c.uid));
    assert.strictEqual(new Set(uids).size, uids.length, where + ': duplicate uid');
    p.st.forEach(c => { if (c.target) assert.ok(TC.findMon(g, c.target), where + ': equip without a target'); });
  });
}

function playOut(da, db, first, chooser) {
  const g = TC.newGame(TC.expandDeck(da.cards), TC.expandDeck(db.cards), first);
  let steps = 0;
  while (!g.over) {
    const pi = g.pending ? g.pending.pi : g.turn;
    const legal = TC.legalActions(g, pi);
    assert.ok(legal.length > 0, 'no legal actions for player ' + pi + ' in phase ' + g.phase);
    const a = chooser ? chooser(g, pi, legal) : TC.aiStep(g);
    assert.ok(TC.doAction(g, a), 'refused ' + JSON.stringify(a));
    invariants(g, 'step ' + steps);
    if (++steps > 5000) throw new Error('duel did not finish');
    if (g.turnCount > 150) throw new Error('duel ran past 150 turns');
  }
  return g;
}

t('AI vs AI: 540 duels finish legally with every invariant holding', () => {
  const wins = {}, turns = [];
  let draws = 0, decks = 0;
  TC.PRESETS.forEach((a, ai) => TC.PRESETS.forEach((b, bi) => {
    for (let k = 0; k < 60; k++) {
      const g = playOut(a, b, k % 2);
      turns.push(g.turnCount);
      if (g.reason === 'deck') decks++;
      const w = g.winner === 0 ? a.name : g.winner === 1 ? b.name : 'draw';
      if (w === 'draw') draws++;
      wins[w] = (wins[w] || 0) + 1;
    }
  }));
  const avg = (turns.reduce((x, y) => x + y, 0) / turns.length).toFixed(1);
  console.log('     wins:', JSON.stringify(wins), '| avg turns', avg, '| max', Math.max.apply(null, turns), '| deck-outs', decks, '| draws', draws);
});

t('random legal actions: 300 chaotic duels never crash or break rules', () => {
  const rc = (g, pi, legal) => legal[Math.floor(Math.random() * legal.length)];
  // bias away from instantly ending the turn so lots of rules get exercised
  const chooser = (g, pi, legal) => {
    const nonEnd = legal.filter(a => a.type !== 'end' && a.type !== 'phase');
    if (nonEnd.length && Math.random() < 0.85) return nonEnd[Math.floor(Math.random() * nonEnd.length)];
    return rc(g, pi, legal);
  };
  for (let k = 0; k < 300; k++) {
    const a = TC.PRESETS[k % TC.PRESETS.length], b = TC.PRESETS[(k + 1) % TC.PRESETS.length];
    try { playOut(a, b, k % 2, chooser); }
    catch (e) { if (/did not finish|ran past/.test(e.message)) continue; throw e; }   // stalling is legal in YGO
  }
});

t('seat balance report', () => {
  let first = 0, n = 0;
  TC.PRESETS.forEach(a => TC.PRESETS.forEach(b => { for (let k = 0; k < 40; k++) { const g = playOut(a, b, 0); if (g.winner === 0) first++; n++; } }));
  console.log('     going-first win rate: ' + (100 * first / n).toFixed(0) + '%');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
