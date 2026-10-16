var TC = (typeof TC === 'undefined') ? {} : TC;

/*
  Opponent AI. Every decision picks the best-scoring action from TC.legalActions, so it can
  only ever make legal moves. Scores are rough "how good is this" numbers; phase/end actions
  have small positive scores so they happen when nothing better is available.
*/
(function () {
  var CARDS = TC.CARDS;

  // Value of an effect's ops for the player who controls it. Custom ops can add score(g, pi, args).
  function opsValue(g, pi, ops) {
    var foe = g.players[1 - pi], v = 0;
    ops.forEach(function (o) {
      var op = TC.OPS[o.op], x;
      switch (o.op) {
        case 'gain': x = o.n / 800; break;
        case 'burn': x = o.n / 520; break;
        case 'draw': x = 2.2 * o.n; break;
        case 'destroy':
          if (o.scope === 'foeMonsters') x = o.pick === 'random' ? (foe.mon.length ? 4 : 0) : 2.5 * foe.mon.length;
          else if (o.scope === 'foeST') x = foe.st.length ? 2.5 : 0;
          else x = 3;
          break;
        case 'buff': x = o.who === 'otherOwnMonsters' ? 1.5 : 1; break;
        default: x = (op && op.score) ? op.score(g, pi, o) : 1.5;
      }
      v += x;
    });
    return v;
  }
  function debutScore(g, pi, eff) { return eff ? opsValue(g, pi, eff.ops) : 0; }

  function monValue(g, pi, m) {
    var s = TC.stats(g, pi, m), d = CARDS[m.id];
    return s.atk * 0.6 + s.def * 0.4 + d.lv * 80;
  }

  function foeInfo(g, pi) {
    var foe = g.players[1 - pi], maxAtk = 0, maxDef = 0, down = 0, up = 0;
    foe.mon.forEach(function (m) {
      if (m.faceDown) { down++; return; }
      up++;
      var s = TC.stats(g, 1 - pi, m);
      if (m.pos === 'atk') maxAtk = Math.max(maxAtk, s.atk);
      maxDef = Math.max(maxDef, s.def);
    });
    return { maxAtk: maxAtk, maxDef: maxDef, down: down, up: up, count: foe.mon.length };
  }

  function scoreSummon(g, pi, a) {
    var p = g.players[pi], c = p.hand[a.idx], d = CARDS[c.id], fi = foeInfo(g, pi);
    var tribAtk = 0, tribVal = 0;
    a.tributes.forEach(function (u) {
      var f = TC.findMon(g, u);
      if (f) { tribAtk += TC.stats(g, pi, f.m).atk; tribVal += monValue(g, pi, f.m); }
    });
    var threat = Math.max(fi.maxAtk, fi.down ? 1500 : 0);
    var s;
    if (a.type === 'summon') {
      s = 4 + d.atk / 500 + debutScore(g, pi, TC.effectOn(d, 'debut'));
      if (d.atk < fi.maxAtk) s -= 3;
      if (d.atk <= threat && fi.count > 0) s -= 1;
      if (TC.hasKw({ id: c.id }, 'direct') && fi.count) s += 1.5;
    } else {
      var flipV = debutScore(g, pi, TC.effectOn(d, 'flip'));
      s = 3 + d.def / 700 + flipV;
      if (d.atk < threat) s += 1.5;
      if (d.atk > threat + 300 && !TC.effectOn(d, 'flip')) s -= 2.5;
      if (!fi.count && d.atk >= 1400) s -= 3;       // nothing to defend against: be aggressive instead
    }
    if (a.tributes.length) {
      s -= tribVal / 700;
      if (d.atk <= tribAtk) s -= 4;
    }
    return s;
  }

  function strongestOwn(g, pi) {
    var best = null, bs = -1;
    g.players[pi].mon.forEach(function (m) {
      if (m.faceDown) return;
      var s = TC.stats(g, pi, m).atk;
      if (s > bs) { bs = s; best = m; }
    });
    return best;
  }

  function scoreOp(g, pi, d, o, tm) {
    var p = g.players[pi], foe = g.players[1 - pi], fi = foeInfo(g, pi);
    switch (o.op) {
      case 'draw': return p.hand.length <= 4 ? 3 * o.n : 1.25 * o.n;
      case 'gain': return p.lp <= 5000 ? 6 : (p.lp >= 7000 ? -1 : 1.5);
      case 'burn': return foe.lp <= o.n ? 100 : (foe.lp <= o.n * 2.7 ? 5 : 3);
      case 'buff':
        if (o.who === 'target') {
          if (!tm) return -1;
          if (o.dur === 'perm') return 3 + TC.stats(g, pi, tm.m).atk / 1000;
          if (g.phase !== 'battle') return -1;
          var s = TC.stats(g, pi, tm.m).atk, best = 0, amt = o.atk || 0;
          foe.mon.forEach(function (t) {
            if (t.faceDown) return;
            var ts = TC.stats(g, 1 - pi, t);
            var need = t.pos === 'atk' ? ts.atk : ts.def;
            if (need >= s && need < s + amt) best = Math.max(best, 5 + need / 1000);
          });
          if (!fi.count && tm.m.attacked !== g.turnCount && g.turnCount > 1) best = Math.max(best, 4);
          return best || -1;
        }
        if (o.who === 'ownMonsters') {
          var n = p.mon.filter(function (m) { return !m.faceDown && m.pos === 'atk' && TC.attacksLeft(g, pi, m) > 0; }).length;
          return (g.phase === 'main1' && n >= 2) ? 1 + n : -1;
        }
        return 2;
      case 'destroy':
        if (o.scope === 'target') {
          if (!tm) return -1;
          if (tm.m.faceDown) return 3;
          var ts2 = TC.stats(g, 1 - pi, tm.m);
          return 3 + Math.max(ts2.atk, ts2.def) / 600;
        }
        if (o.scope === 'foeMonsters' && o.filter === 'atkPos') {
          var list = foe.mon.filter(function (m) { return !m.faceDown && m.pos === 'atk'; });
          if (!list.length) return -1;
          var sum = list.reduce(function (a, m) { return a + TC.stats(g, 1 - pi, m).atk; }, 0);
          return 2 + list.length * 2 + sum / 1500;
        }
        return opsValue(g, pi, [o]);
      case 'flipAll': {
        var own = p.mon.filter(function (m) { return m.faceDown; }).length;
        return fi.down ? 1.5 + fi.down * 2 - own : -1;
      }
    }
    return opsValue(g, pi, [o]);
  }

  function scoreSpell(g, pi, id, target) {
    var d = CARDS[id], p = g.players[pi];
    var tm = target !== undefined && target !== null ? TC.findMon(g, target) : null;
    if (d.sub === 'field') return p.mon.length ? 4 : 1.5;
    if (d.sub === 'continuous') return 3;
    if (d.sub === 'equip') {
      if (!tm) return -1;
      var ts3 = TC.stats(g, pi, tm.m);
      var boostsAtk = d.allPassives.some(function (x) { return x.rule === 'atk' && x.value > 0; });
      if (boostsAtk) return 4 + ts3.atk / 1000;
      return tm.m.pos === 'def' ? 3.5 + ts3.def / 1000 : 1.5;
    }
    var eff = TC.effectOn(d, 'activate');
    if (!eff) return 1;
    var best = -Infinity;
    eff.ops.forEach(function (o) { best = Math.max(best, scoreOp(g, pi, d, o, tm)); });
    return best;
  }

  function scoreAttack(g, pi, a) {
    var af = TC.findMon(g, a.uid);
    if (!af) return -10;
    var A = TC.stats(g, pi, af.m).atk, myVal = monValue(g, pi, af.m);
    var foe = g.players[1 - pi];
    if (a.target.type === 'direct') {
      if (A >= foe.lp) return 1000;
      return 4 + A / 500;
    }
    var tf = TC.findMon(g, a.target.uid);
    if (!tf) return -10;
    var t = tf.m;
    if (t.faceDown) {
      // unknown target: risky unless strong
      var s = 0.5 + (A - 1600) / 600;
      if (g.players[pi].mon.length === 1 && A < 1800) s -= 1;
      return s;
    }
    var ts = TC.stats(g, 1 - pi, t), tv = monValue(g, 1 - pi, t);
    if (t.pos === 'atk') {
      if (A > ts.atk) return 5 + (A - ts.atk) / 500 + tv / 1500;
      if (A === ts.atk) return 0.6 + (tv - myVal) / 1200;
      return -10;
    }
    if (A > ts.def) return 3 + tv / 1500 + (TC.rule(g, 'pierce', { kind: 'mon', pi: pi, m: af.m }) ? (A - ts.def) / 500 : 0);
    if (A === ts.def) return -1;
    return -8;
  }

  function scorePos(g, pi, a) {
    var f = TC.findMon(g, a.uid);
    if (!f) return -1;
    var m = f.m, s = TC.stats(g, pi, m), fi = foeInfo(g, pi);
    if (m.pos === 'def') {
      // go on the offensive when it is safe and useful
      if (g.phase === 'main1' && g.turnCount > 1 && s.atk > fi.maxAtk + 100 && s.atk >= 1000) return 3.2;
      return -1;
    }
    // attack -> defense: only after battle, when the monster would lose a fight
    if (g.phase === 'main2' && (fi.maxAtk > s.atk || (s.def > s.atk && fi.maxAtk >= s.atk - 200))) return 3;
    return -1;
  }

  function scoreRespond(g, pi, a) {
    if (a.uid === null || a.uid === undefined) return 3;           // passing is worth 3
    var p = g.players[pi], card = p.st.filter(function (c) { return c.uid === a.uid; })[0];
    var d = CARDS[card.id], ctx = g.pending.ctx, ch = g.chain, last = ch.links[ch.links.length - 1];
    var eff = TC.effectOn(d, 'activate');
    if (!eff) return 3;
    var root = ctx; while (root.parent) root = root.parent;
    var threat = 1.5, A = 0;
    if (root.kind === 'attack') {
      var af = TC.findMon(g, root.attUid);
      if (!af) return 0;
      A = TC.stats(g, af.pi, af.m).atk;
      if (root.target.type === 'direct') threat = 2 + A / 500;
      else {
        var tf = TC.findMon(g, root.target.uid);
        if (tf) {
          var ts = TC.stats(g, tf.pi, tf.m);
          var need = (tf.m.pos === 'atk' && !tf.m.faceDown) ? ts.atk : ts.def;
          if (A > need) threat = 4 + monValue(g, tf.pi, tf.m) / 600;
          else if (A === need && tf.m.pos === 'atk') threat = 2.5;
        }
      }
    }
    var total = 0, any = false;
    eff.ops.forEach(function (o) {
      any = true;
      switch (o.op) {
        case 'negate':
          if (o.what === 'link') total += last ? 3 + opsValue(g, last.pi, (TC.effectOn(CARDS[last.id], last.kind === 'mon' ? last.on : 'activate') || { ops: [] }).ops) : 0;
          else total += root.kind === 'attack' ? threat + 1.2 : 0;
          break;
        case 'setPos': total += 0.6; break;
        case 'gain': total += o.n / 3000; break;
        case 'destroy':
          if (o.scope === 'attacker') total += root.kind === 'attack' ? threat + 2 + A / 1000 : 0;
          else if (o.scope === 'summoned') {
            var sf = TC.findMon(g, ctx.muid), atk = sf ? TC.stats(g, sf.pi, sf.m).atk : 0;
            total += atk >= 1000 ? 3.5 + atk / 600 : 0;
          } else if (o.scope === 'foeMonsters' && o.filter === 'atkPos') {
            var n = g.players[1 - pi].mon.filter(function (m) { return !m.faceDown && m.pos === 'atk'; }).length;
            total += n >= 2 ? 5 + n * 1.5 : 3.2 + threat * 0.3;
          } else total += 3;
          break;
        case 'buff': {
          // a quick boost on the monster being attacked, when it turns the fight around
          if (root.kind === 'attack' && root.target.type === 'mon' && a.target === root.target.uid) {
            var df = TC.findMon(g, a.target);
            if (df) {
              var st = TC.stats(g, df.pi, df.m), def = df.m.pos === 'atk' && !df.m.faceDown;
              var now = def ? st.atk : st.def, then = now + (def ? (o.atk || 0) : (o.def || 0));
              total += (now <= A && then > A) ? 5.5 : 1;
              break;
            }
          }
          total += 1; break;
        }
        default: total += 3;
      }
    });
    return any ? total : 3;
  }

  function scoreDiscard(g, pi, a) {
    var c = g.players[pi].hand[a.idx], d = CARDS[c.id];
    var v = d.type === 'monster' ? (d.atk + d.def) / 800 : 2.5;
    if (d.type === 'monster' && TC.requiredTributes(d.lv) > g.players[pi].mon.length + 1) v -= 1.5;
    return -v;
  }

  function score(g, pi, a) {
    var p = g.players[pi];
    switch (a.type) {
      case 'respond': return scoreRespond(g, pi, a);
      case 'discard': return scoreDiscard(g, pi, a);
      case 'summon': return scoreSummon(g, pi, a);
      case 'set': {
        var d = CARDS[p.hand[a.idx].id];
        if (d.type === 'monster') return scoreSummon(g, pi, a);
        if (d.type === 'trap') return 3.5;
        if (d.sub === 'quick') return 0.8;
        return -1;
      }
      case 'cast': return scoreSpell(g, pi, p.hand[a.idx].id, a.target);
      case 'castSet': {
        var card = p.st.filter(function (c) { return c.uid === a.uid; })[0];
        return scoreSpell(g, pi, card.id, a.target);
      }
      case 'flip': {
        var f = TC.findMon(g, a.uid).m, fd = CARDS[f.id], fi = foeInfo(g, pi), fe = TC.effectOn(fd, 'flip');
        var s = TC.stats(g, pi, f);
        if (s.atk > fi.maxAtk + 100 && (fi.count || g.turnCount > 1)) return 4 + debutScore(g, pi, fe);
        var fv = debutScore(g, pi, fe);
        return fv >= 2.5 ? 2.5 + fv * 0.3 : -2;
      }
      case 'pos': return scorePos(g, pi, a);
      case 'attack': return scoreAttack(g, pi, a);
      case 'phase': return 0.5;
      case 'end': return g.phase === 'main2' || g.turnCount === 1 ? 0.2 : -5;
    }
    return -100;
  }

  TC.aiStep = function (g) {
    var pi = g.pending ? g.pending.pi : g.turn;
    var acts = TC.legalActions(g, pi);
    if (!acts.length) return { type: 'end' };
    var best = null, bs = -Infinity;
    acts.forEach(function (a) {
      var s = score(g, pi, a) + TC.rand() * 0.3;
      if (s > bs) { bs = s; best = a; }
    });
    return best;
  };

  TC.aiScore = score;
})();
