var TC = (typeof TC === 'undefined') ? {} : TC;

/*
  Otaku Showdown rules engine. Yu-Gi-Oh! Master Rule flavoured: 8000 LP, 5 monster zones, 5 Spell/Trap zones,
  one Normal Summon or Set per turn, Tributes, face-down Defense Position, Flip Summon, battle damage,
  no direct attack while the opponent has a monster that can defend, hand limit 7, no attack on turn 1,
  and chains (Spell Speed 1-3, last in first out).

  GOLDEN RULE: the numbers and switches below are only defaults. Every question the engine asks about a
  rule goes through TC.rule(), and cards change the answer with passives. Card effects are data (ops), so
  engine code does not change when cards are added.
*/
(function () {
  var CARDS = TC.CARDS;
  var START_LP = 8000, MAX_MON = 5, MAX_ST = 5, START_HAND = 5;
  TC.RULES = { START_LP: START_LP, MAX_MON: MAX_MON, MAX_ST: MAX_ST, START_HAND: START_HAND, HAND_LIMIT: 7 };
  TC.rand = Math.random;

  // ---------- small helpers ----------
  function rnd(n) { return Math.floor(TC.rand() * n); }
  function pick(a) { return a.length ? a[rnd(a.length)] : null; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // Log text is written from one player's point of view: TC.viewer is the seat shown as "You" (0 unless an online
  // client sits in seat 1). It only changes wording, never rules.
  TC.viewer = 0;
  function P(pi) { return pi === TC.viewer ? 'You' : 'Opponent'; }
  function say(g, m) { g.log.push(m); if (g.log.length > 120) g.log.shift(); }
  function ev(g, e) { g.events.push(e); }
  function nameOf(id) { return CARDS[id].name; }
  function uidsOf(list) { return list.map(function (x) { return x.uid; }); }

  function mkPlayer(ids) {
    return { lp: START_LP, deck: shuffle(ids.slice()), hand: [], mon: [], st: [], field: null, gy: [] };
  }
  function mkMon(g, id, faceDown, pos) {
    g.uid++;
    return { uid: g.uid, id: id, faceDown: faceDown, pos: pos, placed: g.turnCount, moved: 0, attacked: 0, atkMod: 0, defMod: 0, tmpAtk: 0, tmpDef: 0 };
  }

  function findMon(g, uid) {
    if (uid === undefined || uid === null) return null;
    for (var pi = 0; pi < 2; pi++) {
      var l = g.players[pi].mon;
      for (var i = 0; i < l.length; i++) if (l[i].uid === uid) return { m: l[i], pi: pi };
    }
    return null;
  }
  TC.findMon = findMon;
  function findST(g, uid) {
    for (var pi = 0; pi < 2; pi++) {
      var l = g.players[pi].st;
      for (var i = 0; i < l.length; i++) if (l[i].uid === uid) return { c: l[i], pi: pi };
    }
    return null;
  }

  // ---------- rules: the base value, bent by passives ----------
  function whenOk(g, ps, ownerPi, src, subject) {
    if (!ps.when) return true;
    var ctx = { pi: ownerPi, src: src, subject: subject };
    for (var k in ps.when) if (!TC.CONDS[k].check(g, ctx, ps.when[k])) return false;
    return true;
  }
  function scopeOk(scope, ownerPi, src, subject) {
    switch (scope) {
      case 'self': return src.kind === 'mon' && subject.kind === 'mon' && src.uid === subject.m.uid;
      case 'equipped': return src.kind === 'st' && subject.kind === 'mon' && src.c.target === subject.m.uid;
      case 'ownMonsters': return subject.kind === 'mon' && subject.pi === ownerPi;
      case 'foeMonsters': return subject.kind === 'mon' && subject.pi !== ownerPi;
      case 'allMonsters': return subject.kind === 'mon';
      case 'player': return subject.kind === 'player' && subject.pi === ownerPi;
      case 'foePlayer': return subject.kind === 'player' && subject.pi !== ownerPi;
    }
    return false;
  }
  // subject: { kind: 'mon', pi, m } or { kind: 'player', pi }
  TC.rule = function (g, name, subject, base) {
    var def = TC.RULE_DEFS[name];
    var val = base !== undefined ? base : (def ? def.default : undefined);
    var add = 0, hasAdd = false, setV, hasSet = false;
    function consider(d, ownerPi, src) {
      var ps = d.allPassives;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (p.rule !== name) continue;
        var scope = p.scope || (src.kind === 'mon' ? 'self' : (d.sub === 'equip' ? 'equipped' : 'ownMonsters'));
        if (!scopeOk(scope, ownerPi, src, subject)) continue;
        if (!whenOk(g, p, ownerPi, src, subject)) continue;
        var op = p.op || (typeof p.value === 'number' ? 'add' : 'set');
        if (op === 'add') { add += p.value; hasAdd = true; } else { setV = p.value; hasSet = true; }
      }
    }
    for (var pi = 0; pi < 2; pi++) {
      var pl = g.players[pi], i;
      for (i = 0; i < pl.mon.length; i++) {
        var m = pl.mon[i];
        if (!m.faceDown) consider(CARDS[m.id], pi, { kind: 'mon', uid: m.uid, m: m });
      }
      for (i = 0; i < pl.st.length; i++) {
        var c = pl.st[i];
        if (!c.faceDown) consider(CARDS[c.id], pi, { kind: 'st', uid: c.uid, c: c });
      }
      if (pl.field) consider(CARDS[pl.field.id], pi, { kind: 'field', uid: pl.field.uid });
    }
    if (hasSet) return hasAdd && typeof setV === 'number' ? setV + add : setV;
    return hasAdd ? val + add : val;
  };

  // Current ATK/DEF including permanent boosts, this-turn boosts and every passive in play.
  TC.stats = function (g, pi, m) {
    var d = CARDS[m.id], subject = { kind: 'mon', pi: pi, m: m };
    var atk = d.atk + m.atkMod + m.tmpAtk + TC.rule(g, 'atk', subject, 0);
    var def = d.def + m.defMod + m.tmpDef + TC.rule(g, 'def', subject, 0);
    return { atk: Math.max(0, atk), def: Math.max(0, def) };
  };
  function monRule(g, pi, m, name) { return TC.rule(g, name, { kind: 'mon', pi: pi, m: m }); }
  function playerRule(g, pi, name) { return TC.rule(g, name, { kind: 'player', pi: pi }); }
  TC.handLimit = function (g, pi) { return Math.max(0, playerRule(g, pi, 'handLimit')); };
  TC.attacksLeft = function (g, pi, m) {
    var used = m.atkTurn === g.turnCount ? m.atkN : 0;
    return Math.max(0, monRule(g, pi, m, 'attacksPerTurn') - used);
  };

  // static keyword check on a card (for display and the AI's hand evaluation)
  function hasKw(m, k) { var kw = CARDS[m.id].kw; return !!kw && kw.indexOf(k) >= 0; }
  TC.hasKw = hasKw;

  // ---------- life points, win ----------
  function checkWin(g) {
    if (g.over) return;
    var d0 = g.players[0].lp <= 0, d1 = g.players[1].lp <= 0;
    if (d0 || d1) {
      g.over = true;
      g.winner = (d0 && d1) ? -1 : (d0 ? 1 : 0);
      g.reason = 'lp';
      g.pending = null; g.chain = null;
    }
  }
  function damageLP(g, pi, n) {
    if (n <= 0) return;
    g.players[pi].lp -= n;
    ev(g, { t: 'dmg', pi: pi, n: n });
    checkWin(g);
  }
  function gainLP(g, pi, n) {
    if (n <= 0) return;
    g.players[pi].lp += n;
    ev(g, { t: 'heal', pi: pi, n: n });
  }

  // ---------- cards moving around ----------
  function drawCards(g, pi, n) {
    var p = g.players[pi], got = 0;
    for (var i = 0; i < n; i++) {
      if (!p.deck.length) break;
      g.uid++;
      p.hand.push({ uid: g.uid, id: p.deck.pop() });
      got++;
    }
    return got;
  }
  function removeEquips(g, pi, m) {
    var p = g.players[pi];
    p.st = p.st.filter(function (c) {
      if (c.target === m.uid) { p.gy.push(c.id); return false; }
      return true;
    });
  }
  function leaveField(g, pi, m) {
    var p = g.players[pi], i = p.mon.indexOf(m);
    if (i < 0) return false;
    p.mon.splice(i, 1);
    p.gy.push(m.id);
    removeEquips(g, pi, m);
    return true;
  }
  function destroyMon(g, pi, m) {
    if (leaveField(g, pi, m)) {
      say(g, nameOf(m.id) + ' is destroyed.');
      ev(g, { t: 'destroy', pi: pi, uid: m.uid });
    }
  }
  function destroyST(g, pi, c) {
    var p = g.players[pi], i = p.st.indexOf(c);
    if (i < 0) return;
    p.st.splice(i, 1);
    p.gy.push(c.id);
    say(g, nameOf(c.id) + ' is destroyed.');
  }

  // ---------- effect announcements ----------
  function note(g, pi, label, cardName, desc) {
    var text = (pi === TC.viewer ? '' : 'Opponent: ') + label + ' - ' + cardName + ' ' + desc;
    say(g, text);
    ev(g, { t: 'fx', pi: pi, text: text });
  }

  // ---------- effects as data ----------
  function effectOn(d, on) {
    var list = d.effects || [];
    for (var i = 0; i < list.length; i++) if (list[i].on === on) return list[i];
    return null;
  }
  TC.effectOn = effectOn;
  function cardSpeed(d) {
    if (d.type === 'monster') return 1;
    if (d.type === 'trap') return d.sub === 'counter' ? 3 : 2;
    return d.sub === 'quick' ? 2 : 1;
  }
  TC.cardSpeed = cardSpeed;

  function condsOk(g, link, when) {
    if (!when) return true;
    for (var k in when) if (!TC.CONDS[k].check(g, link, when[k])) return false;
    return true;
  }
  TC.condsOk = condsOk;

  function labelOf(link) {
    if (link.kind === 'mon') return link.on === 'debut' ? 'Debut' : 'Flip';
    if (link.kind === 'trap') return 'Trap';
    var d = CARDS[link.id];
    return d.sub === 'equip' ? 'Equip' : (d.sub === 'quick' ? 'Quick-Play' : 'Spell');
  }
  function mkLink(g, pi, kind, id, uid, on, extra) {
    var d = CARDS[id];
    var l = { pi: pi, kind: kind, id: id, uid: uid, on: on, speed: cardSpeed(d), negated: false };
    for (var k in (extra || {})) l[k] = extra[k];
    return l;
  }
  // Run an effect's ops now and return the description (no chain window).
  function runOps(g, link, eff) {
    if (!eff) return '';
    if (eff.when && !condsOk(g, link, eff.when)) return 'has no effect';
    return eff.ops.map(function (o) { return TC.OPS[o.op].run(g, link, o); }).join(' and ');
  }
  function runInline(g, pi, m, on) {
    var eff = effectOn(CARDS[m.id], on);
    if (!eff) return;
    var link = mkLink(g, pi, 'mon', m.id, m.uid, on, { srcUid: m.uid, ctx: { kind: 'effect', pi: pi } });
    note(g, pi, on === 'flip' ? 'Flip' : 'Debut', nameOf(m.id), runOps(g, link, eff) + '.');
  }

  // Turn a face-down monster face-up. how: 'effect' (card effect), 'battle' (attacked), 'summon' (Flip Summon).
  // Only 'effect' runs the Flip effect right away; the others put it on a chain.
  function flipUp(g, pi, m, how) {
    if (!m.faceDown) return;
    m.faceDown = false;
    say(g, (pi === TC.viewer ? 'Your ' : 'Opponent\'s ') + nameOf(m.id) + ' is flipped face-up.');
    ev(g, { t: 'flip', pi: pi, uid: m.uid });
    if (how === 'effect') runInline(g, pi, m, 'flip');
  }

  TC.api = { say: say, note: note, drawCards: drawCards, gainLP: gainLP, damageLP: damageLP, destroyMon: destroyMon, destroyST: destroyST, flipUp: flipUp, pick: pick };

  // ---------- chains ----------
  // g.chain = { ctx, links: [link, ...] }. The last link resolves first. After a link is added the other
  // player may respond (pending 'respond'); passing, or having nothing to respond with, resolves the chain.
  function triggerOk(d, ch, last, rp) {
    var t = d.trigger;
    if (t === 'any') return true;
    if (t === 'activate') return !!last && last.pi !== rp;
    if (rp === ch.ctx.pi) return false;                       // attack / summon traps answer the other player
    return t === ch.ctx.kind;
  }
  function responseOptions(g, rp, ch) {
    var last = ch.links[ch.links.length - 1];
    var minSpeed = last ? Math.max(1, last.speed) : 1;
    var out = [];
    g.players[rp].st.forEach(function (c) {
      var d = CARDS[c.id];
      if (!c.faceDown || c.setTurn >= g.turnCount) return;
      if (d.type === 'monster' || (d.type === 'spell' && d.sub !== 'quick')) return;
      if (cardSpeed(d) < minSpeed) return;
      if (d.type === 'trap' && !triggerOk(d, ch, last, rp)) return;
      var eff = effectOn(d, 'activate');
      var targets = d.type === 'spell' ? spellTargets(g, rp, d) : [undefined];
      targets.forEach(function (t) {
        var link = { pi: rp, kind: d.type, id: c.id, uid: c.uid, target: t, ctx: ch.ctx, below: last, speed: cardSpeed(d), negated: false };
        if (eff && eff.when && !condsOk(g, link, eff.when)) return;
        out.push(t === undefined ? { uid: c.uid } : { uid: c.uid, target: t });
      });
    });
    return out;
  }
  function startChain(g, ctx, link) {
    g.chain = { ctx: ctx, links: link ? [link] : [] };
    offer(g);
  }
  function offer(g) {
    var ch = g.chain, last = ch.links[ch.links.length - 1];
    var rp = 1 - (last ? last.pi : ch.ctx.pi);
    var opts = responseOptions(g, rp, ch);
    if (!opts.length) { resolveChain(g); return; }
    g.pending = { kind: 'respond', pi: rp, ctx: ch.ctx, options: opts };
  }

  function resolveLink(g, link) {
    var d = CARDS[link.id], p = g.players[link.pi];
    var eff = effectOn(d, link.kind === 'mon' ? link.on : 'activate');
    var cardRef = link.kind === 'mon' ? null : (findST(g, link.uid) || {}).c;
    function toGY() {
      if (cardRef) { var i = p.st.indexOf(cardRef); if (i >= 0) { p.st.splice(i, 1); p.gy.push(link.id); } }
      else if (link.limbo) { p.gy.push(link.id); }
    }
    if (link.negated) {
      say(g, (link.kind === 'mon' ? 'The effect of ' : 'The activation of ') + d.name + ' is negated.');
      if (link.kind !== 'mon') {
        if (cardRef) destroyST(g, link.pi, cardRef); else if (link.limbo) p.gy.push(link.id);
      }
      return;
    }
    if (link.kind === 'mon') {
      note(g, link.pi, labelOf(link), d.name, runOps(g, link, eff) + '.');
      return;
    }
    if (link.kind === 'trap') {
      note(g, link.pi, 'Trap', d.name, runOps(g, link, eff) + '.');
      if (d.sub !== 'continuous') toGY();
      return;
    }
    // spells
    if (d.sub === 'equip') {
      var tf = findMon(g, link.target);
      if (!tf || tf.pi !== link.pi) { say(g, d.name + ' fizzles: its target is gone.'); if (cardRef) destroyST(g, link.pi, cardRef); return; }
      note(g, link.pi, 'Equip', d.name, 'equips to ' + nameOf(tf.m.id) + '.');
    } else if (d.sub === 'continuous') {
      note(g, link.pi, 'Spell', d.name, 'is now active.');
    } else if (d.sub === 'field') {
      if (p.field) p.gy.push(p.field.id);
      p.field = { uid: link.uid, id: link.id };
      link.limbo = false;
      note(g, link.pi, 'Field', d.name, 'is now active.');
    } else {
      note(g, link.pi, labelOf(link), d.name, runOps(g, link, eff) + '.');
      toGY();
    }
  }

  function resolveChain(g) {
    var ch = g.chain;
    g.chain = null; g.pending = null;
    if (ch.links.length > 1) say(g, 'Chain of ' + ch.links.length + ' resolves, last link first.');
    while (ch.links.length && !g.over) {
      var link = ch.links.pop();
      link.below = ch.links[ch.links.length - 1];
      link.ctx = ch.ctx;
      resolveLink(g, link);
    }
    if (!g.over) afterChain(g, ch.ctx);
  }

  function afterChain(g, ctx) {
    if (ctx.kind === 'attack') {
      if (ctx.negated) say(g, 'The attack was negated.'); else battleStep(g, ctx);
    } else if (ctx.kind === 'flip') {
      if (ctx.parent.negated) say(g, 'The attack was negated.'); else battleCalc(g, ctx.parent);
    }
  }

  // ---------- turn flow ----------
  function runStandby(g, pi) {
    var p = g.players[pi];
    p.st.concat(p.mon).forEach(function (c) {
      if (c.faceDown) return;
      var eff = effectOn(CARDS[c.id], 'standby');
      if (!eff) return;
      var link = mkLink(g, pi, CARDS[c.id].type === 'monster' ? 'mon' : 'spell', c.id, c.uid, 'standby', { srcUid: c.uid, ctx: { kind: 'standby', pi: pi } });
      note(g, pi, 'Standby', nameOf(c.id), runOps(g, link, eff) + '.');
    });
  }
  function startTurn(g) {
    var pi = g.turn, p = g.players[pi];
    g.phase = 'main1';
    g.normalUsed = false; g.normalCount = 0;
    if (g.turnCount > 1) {                                  // the very first turn of the duel has no draw
      if (!p.deck.length) {
        g.over = true; g.winner = 1 - pi; g.reason = 'deck';
        say(g, P(pi) + ' cannot draw and loses.');
        return;
      }
      drawCards(g, pi, 1);
    }
    say(g, '--- ' + P(pi) + ' turn ' + g.turnCount + ' ---');
    runStandby(g, pi);
  }
  function finishEnd(g) {
    g.players.forEach(function (p) { p.mon.forEach(function (m) { m.tmpAtk = 0; m.tmpDef = 0; }); });
    g.turn = 1 - g.turn;
    g.turnCount++;
    startTurn(g);
  }

  TC.newGame = function (deckA, deckB, first) {
    var f = (first === 0 || first === 1) ? first : rnd(2);
    var g = {
      players: [mkPlayer(deckA), mkPlayer(deckB)],
      turn: f, first: f, turnCount: 1, phase: 'main1', normalUsed: false, normalCount: 0,
      over: false, winner: null, reason: '', pending: null, chain: null, log: [], events: [], uid: 0
    };
    drawCards(g, 0, START_HAND);
    drawCards(g, 1, START_HAND);
    startTurn(g);
    return g;
  };

  // ---------- legality ----------
  function combos(arr, k) {
    var out = [];
    (function rec(start, cur) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (var i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
    })(0, []);
    return out;
  }
  function spellTargets(g, pi, d) {
    if (!d.target) return [undefined];
    if (d.target === 'own') return g.players[pi].mon.filter(function (m) { return !m.faceDown; }).map(function (m) { return m.uid; });
    return g.players[1 - pi].mon.map(function (m) { return m.uid; });
  }
  TC.spellTargets = function (g, pi, id) { return spellTargets(g, pi, CARDS[id]).filter(function (x) { return x !== undefined; }); };

  function canActivate(g, pi, id, target) {
    var eff = effectOn(CARDS[id], 'activate');
    if (!eff || !eff.when) return true;
    return condsOk(g, { pi: pi, id: id, target: target, ctx: { kind: 'cast', pi: pi } }, eff.when);
  }

  // Which opposing things can this attacker hit? Direct attacks are only allowed when no opposing
  // monster is able to defend (or the attacker can attack directly).
  TC.attackTargets = function (g, pi, m) {
    var foe = g.players[1 - pi];
    var blockers = foe.mon.filter(function (x) { return monRule(g, 1 - pi, x, 'canDefend'); });
    return { direct: blockers.length === 0 || monRule(g, pi, m, 'directAttack'), mons: uidsOf(foe.mon) };
  };

  TC.legalActions = function (g, pi) {
    var out = [];
    if (g.over) return out;
    if (g.pending) {
      if (g.pending.pi !== pi) return out;
      if (g.pending.kind === 'respond') {
        out.push({ type: 'respond', uid: null });
        g.pending.options.forEach(function (o) {
          var a = { type: 'respond', uid: o.uid };
          if (o.target !== undefined) a.target = o.target;
          out.push(a);
        });
      } else if (g.pending.kind === 'discard') {
        g.players[pi].hand.forEach(function (c, i) { out.push({ type: 'discard', idx: i }); });
      }
      return out;
    }
    if (g.turn !== pi) return out;

    var p = g.players[pi];
    var main = g.phase === 'main1' || g.phase === 'main2';
    var battle = g.phase === 'battle';
    var canSummon = (g.normalCount || 0) < playerRule(g, pi, 'summonsPerTurn');

    p.hand.forEach(function (c, idx) {
      var d = CARDS[c.id];
      if (d.type === 'monster') {
        if (main && canSummon) {
          var need = TC.requiredTributes(d.lv);
          if (p.mon.length >= need && p.mon.length - need < MAX_MON) {
            combos(p.mon, need).forEach(function (tr) {
              out.push({ type: 'summon', idx: idx, tributes: uidsOf(tr) });
              out.push({ type: 'set', idx: idx, tributes: uidsOf(tr) });
            });
          }
        }
      } else if (d.type === 'spell') {
        var phaseOk = main || (battle && d.sub === 'quick');
        var zoneOk = d.sub === 'field' || p.st.length < MAX_ST;
        if (phaseOk && zoneOk) spellTargets(g, pi, d).forEach(function (t) { if (canActivate(g, pi, c.id, t)) out.push({ type: 'cast', idx: idx, target: t }); });
        if (main && d.sub !== 'field' && p.st.length < MAX_ST) out.push({ type: 'set', idx: idx, tributes: [] });
      } else {
        if (main && p.st.length < MAX_ST) out.push({ type: 'set', idx: idx, tributes: [] });
      }
    });

    // Spells already Set on the field
    p.st.forEach(function (c) {
      var d = CARDS[c.id];
      if (!c.faceDown || d.type !== 'spell') return;
      var ok = d.sub === 'quick' ? ((main || battle) && c.setTurn < g.turnCount) : main;
      if (ok) spellTargets(g, pi, d).forEach(function (t) { if (canActivate(g, pi, c.id, t)) out.push({ type: 'castSet', uid: c.uid, target: t }); });
    });

    var firstTurnOk = g.turnCount > 1 || playerRule(g, pi, 'attackFirstTurn');
    p.mon.forEach(function (m) {
      if (main) {
        if (m.faceDown && m.placed < g.turnCount) out.push({ type: 'flip', uid: m.uid });
        if (!m.faceDown && m.placed !== g.turnCount && m.attacked !== g.turnCount && m.moved !== g.turnCount && monRule(g, pi, m, 'canChangePosition')) {
          out.push({ type: 'pos', uid: m.uid });
        }
      }
      if (battle && firstTurnOk && !m.faceDown && m.pos === 'atk' && monRule(g, pi, m, 'canAttack') && TC.attacksLeft(g, pi, m) > 0) {
        var t = TC.attackTargets(g, pi, m);
        if (t.direct) out.push({ type: 'attack', uid: m.uid, target: { type: 'direct' } });
        t.mons.forEach(function (u) { out.push({ type: 'attack', uid: m.uid, target: { type: 'mon', uid: u } }); });
      }
    });

    if (g.phase === 'main1' && firstTurnOk) out.push({ type: 'phase', to: 'battle' });
    if (battle) out.push({ type: 'phase', to: 'main2' });
    out.push({ type: 'end' });
    return out;
  };

  function key(a) {
    return [a.type, a.idx, a.uid, a.to, a.target && typeof a.target === 'object' ? a.target.type + ':' + a.target.uid : a.target,
      (a.tributes || []).slice().sort().join(',')].join('|');
  }
  TC.actionKey = key;

  function isLegal(g, a) {
    var pi = g.pending ? g.pending.pi : g.turn;
    var k = key(a);
    return TC.legalActions(g, pi).some(function (x) { return key(x) === k; });
  }

  // Plain-language reason a hand card cannot be played right now (for the UI).
  TC.explain = function (g, pi, idx) {
    var p = g.players[pi], c = p.hand[idx];
    if (!c) return '';
    var d = CARDS[c.id];
    if (g.over) return 'The duel is over.';
    if (g.pending && g.pending.pi === pi && g.pending.kind === 'discard') return 'Discard down to ' + TC.handLimit(g, pi) + ' cards first.';
    if (g.pending) return 'Waiting for a response.';
    if (g.turn !== pi) return 'It is not your turn.';
    var main = g.phase === 'main1' || g.phase === 'main2';
    if (d.type === 'monster') {
      if (!main) return 'Monsters can only be Summoned or Set in a Main Phase.';
      if ((g.normalCount || 0) >= playerRule(g, pi, 'summonsPerTurn')) return 'You already Summoned or Set a monster this turn.';
      var need = TC.requiredTributes(d.lv);
      if (p.mon.length < need) return 'Needs ' + need + ' Tribute' + (need > 1 ? 's' : '') + ' (Level ' + d.lv + ').';
      return 'Not available.';
    }
    if (d.type === 'spell') {
      if (!main && d.sub !== 'quick') return 'Only usable in a Main Phase.';
      if (d.sub !== 'field' && p.st.length >= MAX_ST) return 'Your Spell/Trap zones are full.';
      if (d.target === 'own' && !p.mon.some(function (m) { return !m.faceDown; })) return 'Needs a face-up monster you control.';
      if (d.target === 'foe' && !g.players[1 - pi].mon.length) return 'Your opponent has no monsters.';
      if (!canActivate(g, pi, c.id, undefined)) return 'Its condition is not met.';
      return 'Not available.';
    }
    if (!main) return 'Traps can only be Set in a Main Phase.';
    if (p.st.length >= MAX_ST) return 'Your Spell/Trap zones are full.';
    return 'Not available.';
  };

  // ---------- battle ----------
  function battleStep(g, ctx) {
    var af = findMon(g, ctx.attUid);
    if (!af || af.pi !== ctx.pi) return;                 // attacker is gone: attack ends
    var att = af.m, apI = af.pi, dpI = 1 - apI;

    if (ctx.target.type === 'direct') {
      var dmg = TC.stats(g, apI, att).atk;
      say(g, nameOf(att.id) + ' attacks directly for ' + dmg + '.');
      damageLP(g, dpI, dmg);
      return;
    }
    var tf = findMon(g, ctx.target.uid);
    if (!tf || tf.pi !== dpI) { say(g, 'The attack target is gone.'); return; }
    var tgt = tf.m;
    if (tgt.faceDown) {
      flipUp(g, dpI, tgt, 'battle');
      var eff = effectOn(CARDS[tgt.id], 'flip');
      if (eff) {                                         // the Flip effect goes on a chain before damage is calculated
        var fctx = { kind: 'flip', pi: dpI, muid: tgt.uid, parent: ctx };
        startChain(g, fctx, mkLink(g, dpI, 'mon', tgt.id, tgt.uid, 'flip', { srcUid: tgt.uid }));
        return;
      }
    }
    battleCalc(g, ctx);
  }

  function battleCalc(g, ctx) {
    var af = findMon(g, ctx.attUid);
    if (!af || af.pi !== ctx.pi) return;
    var att = af.m, apI = af.pi, dpI = 1 - apI;
    var tf = findMon(g, ctx.target.uid);
    if (!tf || tf.pi !== dpI) { say(g, 'The attack target is gone.'); return; }
    var tgt = tf.m, aName = nameOf(att.id), tName = nameOf(tgt.id);
    var A = TC.stats(g, apI, att).atk;
    if (tgt.pos === 'atk') {
      var D = TC.stats(g, dpI, tgt).atk;
      say(g, aName + ' (' + A + ') battles ' + tName + ' (' + D + ').');
      if (A > D) { destroyMon(g, dpI, tgt); damageLP(g, dpI, A - D); }
      else if (A < D) { destroyMon(g, apI, att); damageLP(g, apI, D - A); }
      else { destroyMon(g, apI, att); destroyMon(g, dpI, tgt); }
    } else {
      var DF = TC.stats(g, dpI, tgt).def;
      say(g, aName + ' (' + A + ') attacks ' + tName + ' in Defense (' + DF + ').');
      if (A > DF) {
        destroyMon(g, dpI, tgt);
        if (monRule(g, apI, att, 'pierce')) damageLP(g, dpI, A - DF);
      } else if (A < DF) {
        damageLP(g, apI, DF - A);
      }
    }
  }

  // ---------- applying actions ----------
  TC.doAction = function (g, a) {
    if (!isLegal(g, a)) return false;
    var pi = g.pending ? g.pending.pi : g.turn;
    var p = g.players[pi];

    switch (a.type) {
      case 'summon':
      case 'set': {
        var c = p.hand[a.idx], d = CARDS[c.id];
        if (d.type !== 'monster') {                     // Set a Spell/Trap
          p.hand.splice(a.idx, 1);
          p.st.push({ uid: c.uid, id: c.id, faceDown: true, setTurn: g.turnCount });
          say(g, P(pi) + ': set a card.');
          break;
        }
        a.tributes.forEach(function (u) {
          var f = findMon(g, u);
          if (f) { leaveField(g, f.pi, f.m); say(g, P(pi) + ': tributed ' + (f.m.faceDown && pi !== TC.viewer ? 'a monster' : nameOf(f.m.id)) + '.'); }
        });
        p.hand.splice(a.idx, 1);
        g.normalCount = (g.normalCount || 0) + 1; g.normalUsed = true;
        var set = a.type === 'set';
        var m = mkMon(g, c.id, set, set ? 'def' : 'atk');
        m.uid = c.uid;
        p.mon.push(m);
        if (set) {
          say(g, P(pi) + ': set a monster face-down.');
        } else {
          say(g, P(pi) + ': summoned ' + d.name + '.');
          ev(g, { t: 'summon', pi: pi, uid: m.uid });
          var debut = effectOn(d, 'debut');
          startChain(g, { kind: 'summon', pi: pi, muid: m.uid, mode: 'summon' },
            debut ? mkLink(g, pi, 'mon', m.id, m.uid, 'debut', { srcUid: m.uid }) : null);
        }
        break;
      }
      case 'flip': {
        var fm = findMon(g, a.uid).m;
        fm.faceDown = false; fm.pos = 'atk'; fm.moved = g.turnCount;
        say(g, P(pi) + ': Flip Summoned ' + nameOf(fm.id) + '.');
        ev(g, { t: 'flip', pi: pi, uid: fm.uid });
        var feff = effectOn(CARDS[fm.id], 'flip');
        startChain(g, { kind: 'summon', pi: pi, muid: fm.uid, mode: 'flip' },
          feff ? mkLink(g, pi, 'mon', fm.id, fm.uid, 'flip', { srcUid: fm.uid }) : null);
        break;
      }
      case 'pos': {
        var pm = findMon(g, a.uid).m;
        pm.pos = pm.pos === 'atk' ? 'def' : 'atk';
        pm.moved = g.turnCount;
        say(g, P(pi) + ': switched ' + nameOf(pm.id) + ' to ' + (pm.pos === 'atk' ? 'Attack' : 'Defense') + ' Position.');
        break;
      }
      case 'cast':
      case 'castSet': {
        var card, fromHand = a.type === 'cast';
        if (fromHand) { card = p.hand[a.idx]; p.hand.splice(a.idx, 1); }
        else { card = p.st.filter(function (x) { return x.uid === a.uid; })[0]; }
        var sd = CARDS[card.id];
        say(g, P(pi) + ': activated ' + sd.name + '.');
        ev(g, { t: 'cast', pi: pi, id: card.id });
        var link = mkLink(g, pi, 'spell', card.id, card.uid, 'activate', { target: a.target });
        if (fromHand) {
          if (sd.sub === 'equip' || sd.sub === 'continuous') p.st.push({ uid: card.uid, id: card.id, faceDown: false, setTurn: g.turnCount, target: sd.sub === 'equip' ? a.target : undefined });
          else link.limbo = true;                       // normal / quick / field: held aside until it resolves
        } else {
          card.faceDown = false;
          if (sd.sub === 'equip') card.target = a.target;
          if (sd.sub === 'field') { p.st.splice(p.st.indexOf(card), 1); link.limbo = true; }
        }
        startChain(g, { kind: 'cast', pi: pi }, link);
        break;
      }
      case 'attack': {
        var att = findMon(g, a.uid).m;
        if (att.atkTurn !== g.turnCount) { att.atkTurn = g.turnCount; att.atkN = 0; }
        att.atkN++;
        att.attacked = g.turnCount;
        say(g, P(pi) + ': ' + nameOf(att.id) + ' declares an attack.');
        ev(g, { t: 'atk', pi: pi, uid: att.uid });
        startChain(g, { kind: 'attack', pi: pi, attUid: att.uid, target: a.target, negated: false }, null);
        break;
      }
      case 'phase':
        g.phase = a.to;
        break;
      case 'end': {
        var lim = TC.handLimit(g, pi);
        if (p.hand.length > lim) g.pending = { kind: 'discard', pi: pi, n: p.hand.length - lim };
        else finishEnd(g);
        break;
      }
      case 'respond': {
        var ch = g.chain;
        g.pending = null;
        if (a.uid === null || a.uid === undefined) { resolveChain(g); break; }
        var card2 = p.st.filter(function (x) { return x.uid === a.uid; })[0];
        var rd = CARDS[card2.id];
        card2.faceDown = false;
        say(g, P(pi) + ': activated ' + rd.name + '!');
        ev(g, { t: 'cast', pi: pi, id: card2.id });
        ch.links.push(mkLink(g, pi, rd.type, card2.id, card2.uid, 'activate', { target: a.target }));
        offer(g);
        break;
      }
      case 'discard': {
        var dc = p.hand.splice(a.idx, 1)[0];
        p.gy.push(dc.id);
        say(g, P(pi) + ': discarded ' + (pi === TC.viewer ? nameOf(dc.id) : 'a card') + '.');
        g.pending.n--;
        if (g.pending.n <= 0) { g.pending = null; finishEnd(g); }
        break;
      }
    }
    checkWin(g);
    return true;
  };
})();
