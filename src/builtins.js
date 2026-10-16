/*
  Built-in rules, keywords, effect ops and conditions. Expansions can add more of each from their own
  file (TC.registerRule / registerKeyword / registerOp / registerCond) without editing the engine.

  RULES are the numbers and switches the game queries ("how many attacks does this monster get?").
  A card changes a rule with a passive: { rule, value, op?, scope?, when? }.
    op: 'add' (default for numbers) or 'set' (default for true/false). scope: where the passive applies
    self | equipped | ownMonsters | foeMonsters | allMonsters | player | foePlayer (default self for monsters).
  This is the golden rule: the base rule is just the default, and cards bend it.
*/
(function () {
  function A() { return TC.api; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // ---------- rules ----------
  TC.registerRule('atk', { default: 0, label: 'ATK', describe: function (p) { return 'ATK ' + (p.value >= 0 ? '+' : '') + p.value + '.'; } });
  TC.registerRule('def', { default: 0, label: 'DEF', describe: function (p) { return 'DEF ' + (p.value >= 0 ? '+' : '') + p.value + '.'; } });
  TC.registerRule('handLimit', { default: 7, label: 'Hand limit', describe: function (p) {
    return p.op === 'set' ? 'Your hand limit is ' + p.value + '.' : 'Your hand limit is ' + (p.value >= 0 ? '+' : '') + p.value + '.'; } });
  TC.registerRule('attacksPerTurn', { default: 1, label: 'Attacks per turn', describe: function (p) {
    return p.op === 'set' ? 'This monster can attack ' + plural(p.value, 'time') + ' each turn.' : 'This monster can attack ' + plural(1 + p.value, 'time') + ' each turn.'; } });
  TC.registerRule('canAttack', { default: true, label: 'Can attack', describe: function (p) { return p.value ? '' : 'Cannot attack.'; } });
  TC.registerRule('canDefend', { default: true, label: 'Can defend', describe: function (p) { return p.value ? '' : 'Cannot Defend.'; } });
  TC.registerRule('directAttack', { default: false, label: 'Direct attack', describe: function (p) { return p.value ? 'Can attack directly.' : ''; } });
  TC.registerRule('pierce', { default: false, label: 'Pierce', describe: function (p) { return p.value ? 'Pierce.' : ''; } });
  TC.registerRule('canChangePosition', { default: true, label: 'Can change position', describe: function (p) { return p.value ? '' : 'Cannot change battle position.'; } });
  TC.registerRule('summonsPerTurn', { default: 1, label: 'Normal Summons per turn', describe: function (p) {
    return 'You can Normal Summon or Set ' + plural(1 + p.value, 'monster') + ' each turn.'; } });
  TC.registerRule('attackFirstTurn', { default: false, label: 'Attack on the first turn', describe: function (p) { return p.value ? 'You can attack on the first turn of the duel.' : ''; } });

  // ---------- keywords (shorthand for passives) ----------
  TC.registerKeyword('pierce', {
    label: 'Pierce', text: 'When this monster attacks a Defense Position monster, the difference is dealt as damage to the opponent.',
    passives: [{ rule: 'pierce', value: true, scope: 'self' }]
  });
  TC.registerKeyword('direct', {
    label: 'Direct', text: 'Can attack the opponent directly even if they control monsters.',
    passives: [{ rule: 'directAttack', value: true, scope: 'self' }]
  });
  TC.registerKeyword('noblock', {
    label: 'Cannot Defend', text: 'Does not stop direct attacks. If an opponent controls only monsters that cannot defend, attackers may go straight for their Life Points.',
    passives: [{ rule: 'canDefend', value: false, scope: 'self' }]
  });

  // ---------- conditions ----------
  TC.registerCond('summonedAtkGte', { check: function (g, link, v) {
    var ctx = link.ctx || {};
    if (ctx.kind !== 'summon') return false;
    var f = TC.findMon(g, ctx.muid);
    return !!f && !f.m.faceDown && TC.stats(g, f.pi, f.m).atk >= v;
  } });
  TC.registerCond('belowIsSpellTrap', { check: function (g, link) {
    var b = link.below;
    return !!b && b.pi !== link.pi && (b.kind === 'spell' || b.kind === 'trap');
  } });
  TC.registerCond('subjectPos', { check: function (g, ctx, v) { return !!(ctx.subject && ctx.subject.m && ctx.subject.m.pos === v); } });

  // ---------- ops ----------
  var NAME = function (id) { return TC.CARDS[id].name; };

  TC.registerOp('gain', {
    text: function (a) { return 'gain ' + a.n + ' Life Points'; },
    run: function (g, link, a) { A().gainLP(g, link.pi, a.n); return 'restores ' + a.n + ' LP'; }
  });
  TC.registerOp('burn', {
    text: function (a) { return 'inflict ' + a.n + ' damage to your opponent'; },
    run: function (g, link, a) { A().damageLP(g, 1 - link.pi, a.n); return 'inflicts ' + a.n + ' damage'; }
  });
  TC.registerOp('draw', {
    text: function (a) { return 'draw ' + plural(a.n, 'card'); },
    run: function (g, link, a) {
      var n = A().drawCards(g, link.pi, a.n);
      return n ? (n === 1 ? 'draws a card' : 'draws ' + n + ' cards') : 'finds the deck empty';
    }
  });

  // destroy: scope = foeMonsters | ownMonsters | foeST | target | attacker | summoned
  //          pick = all (default) | random ; filter = atkPos
  TC.registerOp('destroy', {
    text: function (a) {
      var s = a.scope, filt = a.filter === 'atkPos' ? 'Attack Position ' : '';
      if (s === 'foeMonsters') return a.pick === 'random' ? 'destroy 1 random monster your opponent controls' : 'destroy all ' + filt + 'monsters your opponent controls';
      if (s === 'ownMonsters') return a.pick === 'random' ? 'destroy 1 random monster you control' : 'destroy all monsters you control';
      if (s === 'foeST') return 'destroy 1 random Spell/Trap your opponent controls';
      if (s === 'target') return 'destroy it';
      if (s === 'attacker') return 'destroy the attacking monster';
      return 'destroy the Summoned monster';
    },
    run: function (g, link, a) {
      var api = A(), ctx = link.ctx || {}, foe = 1 - link.pi, list = [], st = false;
      switch (a.scope) {
        case 'foeMonsters': list = g.players[foe].mon.map(function (m) { return { pi: foe, m: m }; }); break;
        case 'ownMonsters': list = g.players[link.pi].mon.map(function (m) { return { pi: link.pi, m: m }; }); break;
        case 'foeST': st = true; list = g.players[foe].st.map(function (c) { return { pi: foe, c: c }; }); break;
        case 'target': { var f = TC.findMon(g, link.target); if (f) list = [{ pi: f.pi, m: f.m }]; break; }
        case 'attacker': { var f2 = TC.findMon(g, ctx.attUid || (ctx.parent && ctx.parent.attUid)); if (f2) list = [{ pi: f2.pi, m: f2.m }]; break; }
        case 'summoned': { var f3 = TC.findMon(g, ctx.muid); if (f3) list = [{ pi: f3.pi, m: f3.m }]; break; }
      }
      if (a.filter === 'atkPos') list = list.filter(function (x) { return !x.m.faceDown && x.m.pos === 'atk'; });
      if (a.pick === 'random' && list.length) list = [api.pick(list)];
      if (!list.length) return st ? 'finds no Spell/Trap to destroy' : 'finds no monster to destroy';
      var names = list.map(function (x) { return st ? NAME(x.c.id) : NAME(x.m.id); });
      list.forEach(function (x) { if (st) api.destroyST(g, x.pi, x.c); else api.destroyMon(g, x.pi, x.m); });
      return list.length === 1 ? 'destroys ' + names[0] : 'destroys ' + list.length + ' monsters';
    }
  });

  // buff: who = target | self | ownMonsters | otherOwnMonsters ; atk/def amounts ; dur = turn | perm ; faceUp = only face-up
  TC.registerOp('buff', {
    text: function (a) {
      var amt = (a.atk && a.def && a.atk === a.def) ? a.atk + ' ATK and DEF' : (a.atk ? a.atk + ' ATK' : '') + (a.atk && a.def ? ' and ' : '') + (a.def ? a.def + ' DEF' : '');
      var when = a.dur === 'perm' ? ' permanently' : ' until the end of this turn';
      if (a.who === 'target') return 'it gains ' + amt + when;
      if (a.who === 'self') return 'this monster gains ' + amt + when;
      if (a.who === 'otherOwnMonsters') return 'your other monsters gain ' + amt + when;
      return (a.faceUp ? 'all face-up monsters you control' : 'monsters you control') + ' gain ' + amt + when;
    },
    run: function (g, link, a) {
      var api = A(), list = [];
      if (a.who === 'target') { var f = TC.findMon(g, link.target); if (f && f.pi === link.pi) list = [f.m]; }
      else if (a.who === 'self') { var fs = TC.findMon(g, link.srcUid); if (fs) list = [fs.m]; }
      else list = g.players[link.pi].mon.filter(function (m) { return a.who !== 'otherOwnMonsters' || m.uid !== link.srcUid; });
      if (a.faceUp) list = list.filter(function (m) { return !m.faceDown; });
      if (!list.length) return a.who === 'otherOwnMonsters' ? 'has no allies to strengthen' : 'has no effect';
      list.forEach(function (m) {
        if (a.dur === 'perm') { m.atkMod += a.atk || 0; m.defMod += a.def || 0; }
        else { m.tmpAtk += a.atk || 0; m.tmpDef += a.def || 0; }
      });
      var amt = (a.atk && a.def && a.atk === a.def) ? a.atk + ' ATK/DEF' : (a.atk ? a.atk + ' ATK' : '') + (a.atk && a.def ? ' and ' : '') + (a.def ? a.def + ' DEF' : '');
      var when = a.dur === 'perm' ? ' permanently' : ' this turn';
      if (a.who === 'target' || a.who === 'self') return NAME(list[0].id) + ' gains ' + amt + when;
      return a.who === 'otherOwnMonsters' ? 'gives your other monsters +' + amt.replace(' ATK/DEF', ' ATK/DEF') + when : 'your monsters gain ' + amt + when;
    }
  });

  // negate: what = attack | link (the card or effect this one was chained to)
  TC.registerOp('negate', {
    text: function (a) { return a.what === 'link' ? 'negate the activation of that card or effect' : 'negate the attack'; },
    run: function (g, link, a) {
      if (a.what === 'link') {
        var b = link.below;
        if (!b) return 'has nothing to negate';
        b.negated = true;
        return 'negates ' + NAME(b.id);
      }
      var c = link.ctx || {};
      while (c.parent) c = c.parent;
      c.negated = true;
      return 'negates the attack';
    }
  });
  TC.registerOp('setPos', {
    text: function (a) { return 'change the attacker to ' + (a.pos === 'def' ? 'Defense' : 'Attack') + ' Position'; },
    run: function (g, link, a) {
      var c = link.ctx || {};
      while (c.parent) c = c.parent;
      var f = TC.findMon(g, c.attUid);
      if (f && !f.m.faceDown) f.m.pos = a.pos;
      return 'turns the attacker to ' + (a.pos === 'def' ? 'Defense' : 'Attack') + ' Position';
    }
  });
  TC.registerOp('flipAll', {
    text: function () { return 'flip all face-down monsters on the field face-up in Defense Position. Flip effects activate'; },
    run: function (g) {
      var n = 0;
      [0, 1].forEach(function (pi) {
        g.players[pi].mon.slice().forEach(function (m) { if (m.faceDown && !g.over) { A().flipUp(g, pi, m, 'effect'); n++; } });
      });
      return n ? 'flips ' + plural(n, 'monster') + ' face-up' : 'finds no face-down monsters';
    }
  });
})();
