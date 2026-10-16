var TCUI = (typeof TCUI === 'undefined') ? {} : TCUI;

(function () {
  'use strict';
  var CARDS = TC.CARDS, KW = TC.KW;
  var RECORD_KEY = 'trope-clash-record-v2';   // storage keys keep their old names so saved records and decks survive the rename

  var G = null;
  var ui = { focus: null, mode: null };
  var aiBusy = false, quitArm = false, quitTimer = null;
  // Seats: engine player 0 is the first seat. In a solo duel I am seat 0; online, the host is seat 0 and the guest
  // seat 1. The screen always shows me at the bottom, so DOM ids and data-side use a role (0 = me, 1 = opponent).
  var ME = 0, FOE = 1, online = null, savedRand = null;
  function role(pi) { return pi === ME ? 0 : 1; }

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // ---------- win record (per browser, optional) ----------
  function readRecord() {
    try {
      var r = JSON.parse(localStorage.getItem(RECORD_KEY) || 'null');
      if (r && typeof r.w === 'number') return r;
    } catch (e) { /* storage unavailable */ }
    return { w: 0, l: 0, d: 0 };
  }
  function writeRecord(r) { try { localStorage.setItem(RECORD_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ } }
  TCUI.recordText = function () {
    var r = readRecord(), n = r.w + r.l + r.d;
    return n ? 'Record: ' + r.w + ' won, ' + r.l + ' lost' + (r.d ? ', ' + r.d + ' drawn' : '') : 'No duels played yet.';
  };

  // ---------- helpers ----------
  function decider() { return G.pending ? G.pending.pi : G.turn; }
  function mine() { return !!G && !G.over && decider() === ME; }
  function myActs() { return mine() ? TC.legalActions(G, ME) : []; }
  function handIndex(uid) {
    var h = G.players[ME].hand;
    for (var i = 0; i < h.length; i++) if (h[i].uid === uid) return i;
    return -1;
  }
  function stCard(uid) {
    for (var pi = 0; pi < 2; pi++) {
      var l = G.players[pi].st;
      for (var i = 0; i < l.length; i++) if (l[i].uid === uid) return { c: l[i], pi: pi };
    }
    return null;
  }
  function phaseName(p) { return p === 'main1' ? 'Main Phase 1' : p === 'battle' ? 'Battle Phase' : 'Main Phase 2'; }

  // ---------- online helpers ----------
  // Seeded random numbers: both players run the same engine with the same seed and the same moves, so they
  // always see the same shuffles and random picks. Only moves travel over the connection.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // A short fingerprint of the visible game state. Sent with every move so a mismatch is caught immediately.
  function stateHash(g) {
    var parts = [g.turnCount, g.turn, g.phase, g.over ? 1 : 0, g.pending ? g.pending.kind + g.pending.pi : '', g.chain ? g.chain.links.length : 0];
    g.players.forEach(function (p) {
      parts.push(p.lp, p.deck.length, p.gy.length, p.hand.map(function (c) { return c.uid + c.id; }).join(','),
        p.mon.map(function (m) { return [m.uid, m.id, m.pos, m.faceDown ? 1 : 0, m.atkMod, m.defMod, m.tmpAtk].join(':'); }).join(','),
        p.st.map(function (c) { return c.uid + c.id + (c.faceDown ? 1 : 0); }).join(','), p.field ? p.field.id : '');
    });
    var h = 2166136261, str = parts.join('|');
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }
  function leaveOnline() {
    if (savedRand) { TC.rand = savedRand; savedRand = null; }
    online = null; ME = 0; FOE = 1; TC.viewer = 0;
  }
  function netSend(msg) { if (online && online.net) { try { online.net.send(msg); } catch (e) { /* link is gone; the close handler reports it */ } } }
  function endOnline(reason, winner) {
    if (!G || G.over) return;
    G.over = true; G.winner = winner; G.reason = reason; G.pending = null; G.chain = null;
    ui.mode = null; ui.focus = null;
    render();
  }

  // ---------- start / resume ----------
  TCUI.duel = {
    start: function (deckCards) {
      leaveOnline();
      var foe = TC.PRESETS[Math.floor(Math.random() * TC.PRESETS.length)];
      G = TC.newGame(TC.expandDeck(deckCards), TC.expandDeck(foe.cards));
      G.foeName = foe.name; G.foeGlyph = foe.glyph; G.recorded = false;
      ui.focus = null; ui.mode = null; aiBusy = false;
      G.log.push(G.first === 0 ? 'You go first. (No draw or attack on the first turn.)' : 'Opponent goes first.');
      render();
      drive();
    },
    // o: { me: 0|1, seed, first, decks: [hostCards, guestCards], names: [host, guest], net: { send(msg) } }
    startOnline: function (o) {
      leaveOnline();
      online = { net: o.net, moveN: 0 };
      ME = o.me; FOE = 1 - o.me; TC.viewer = ME;
      savedRand = TC.rand;
      TC.rand = mulberry32(o.seed);
      G = TC.newGame(TC.expandDeck(o.decks[0]), TC.expandDeck(o.decks[1]), o.first);
      G.foeName = o.names[FOE]; G.foeGlyph = '友'; G.recorded = false; G.online = true;
      ui.focus = null; ui.mode = null; aiBusy = false;
      G.log.push(G.first === ME ? 'You go first. (No draw or attack on the first turn.)' : G.foeName + ' goes first.');
      hideOverlays();
      render();
    },
    // messages from the other player (moves, resignation, connection loss)
    netMessage: function (msg) {
      if (!G || !online || G.over) return;
      if (msg.t === 'move') {
        var bad = msg.n !== online.moveN || decider() !== FOE;
        var ok = !bad && TC.doAction(G, msg.a);
        if (!ok || stateHash(G) !== msg.h) {
          G.log.push('Out of sync with your opponent (move ' + msg.n + ').');
          netSend({ t: 'desync', n: msg.n });
          endOnline('desync', null);
          return;
        }
        online.moveN++;
        ui.mode = null;
        render();
      } else if (msg.t === 'resign') {
        endOnline('resign', ME);
      } else if (msg.t === 'desync') {
        endOnline('desync', null);
      }
    },
    netLost: function () { if (online) endOnline('disconnect', null); },
    isOnline: function () { return !!online; },
    resume: function (g) {
      leaveOnline();
      G = g; G.events = []; ui.focus = null; ui.mode = null; aiBusy = false;
      render();
      drive();
    },
    state: function () { return G; },
    stop: function () { leaveOnline(); G = null; aiBusy = false; hideOverlays(); }
  };

  function hideOverlays() {
    $('#over').hidden = true; $('#prompt').hidden = true; $('#modal').hidden = true;
  }

  // ---------- rendering ----------
  function render() {
    if (!G) return;
    renderBar(FOE); renderBar(ME);
    renderZones(FOE); renderZones(ME);
    renderMid();
    renderHand();
    renderPrompt();
    flushEvents();
    checkOver();
  }

  function renderBar(pi) {
    var p = G.players[pi], r = role(pi);
    var el = document.getElementById('bar-' + r);
    var pct = Math.max(0, Math.min(100, p.lp / TC.RULES.START_LP * 100));
    var tgt = r === 1 && ui.mode && ui.mode.k === 'attack' && ui.mode.direct;
    var turn = !G.over && G.turn === pi;
    el.className = 'bar ' + (r ? 'foe' : 'you') + (tgt ? ' tgt' : '') + (turn ? ' turn' : '');
    el.setAttribute('data-hero', r);
    el.innerHTML =
      '<span class="avatar ' + (r ? 'foe' : 'you') + '" aria-hidden="true">' + (r ? esc(G.foeGlyph || '敵') : '主') + '</span>' +
      '<span class="bmain">' +
        '<span class="brow"><b class="bname">' + (r ? esc(G.foeName || 'Opponent') : 'You') + '</b>' +
        '<span class="lp" aria-label="Life Points">' + Math.max(0, p.lp) + '</span></span>' +
        '<span class="lp-track"><span class="lp-fill' + (p.lp <= 2000 ? ' low' : '') + '" style="width:' + pct + '%"></span></span>' +
        '<span class="chips2">' +
          '<span class="c2">Deck ' + p.deck.length + '</span><span class="c2">Hand ' + p.hand.length + '</span>' +
          '<button class="c2 btn" data-gy="' + pi + '">Grave ' + p.gy.length + '</button>' +
          (r === 0 ? '<button class="c2 btn" data-act="log">Log</button>' : '') +
        '</span>' +
      '</span>' +
      (r === 1 ? '<button class="quit" data-act="quit">' + (quitArm ? 'Sure?' : 'Menu') + '</button>' : '');
  }

  function stats(pi, m) { return TC.stats(G, pi, m); }

  function monCell(m, pi) {
    var d = CARDS[m.id], s = stats(pi, m);
    var acts = ui.mode ? null : null;
    var md = ui.mode;
    var canAttack = pi === ME && mine() && G.phase === 'battle' && myActs().some(function (a) { return a.type === 'attack' && a.uid === m.uid; });
    var sel = ui.focus && ui.focus.k === 'mon' && ui.focus.uid === m.uid;
    var tgt = md && ((md.k === 'attack' && pi === FOE && md.mons.indexOf(m.uid) >= 0) || (md.k === 'target' && md.valid.indexOf(m.uid) >= 0));
    var pick = md && md.k === 'tribute' && pi === ME;
    var picked = pick && md.chosen.indexOf(m.uid) >= 0;
    var cls = 'mon ' + (pi === ME ? 'mine' : 'foe') + (m.faceDown ? ' fd' : '') + (m.pos === 'def' ? ' def' : '') +
      (canAttack && !md ? ' ready' : '') + (sel ? ' sel' : '') + (tgt ? ' tgt' : '') + (pick ? ' pick' : '') + (picked ? ' picked' : '');
    var face;
    if (m.faceDown && pi === FOE) {
      face = '<span class="face back"><span class="art">裏</span></span>';
    } else if (m.faceDown) {
      face = '<span class="face setcard"><span class="art">' + d.glyph + '</span><span class="nm">' + esc(d.name) + '</span><span class="stag">SET</span></span>';
    } else {
      var ca = s.atk > d.atk ? ' up' : (s.atk < d.atk ? ' dn' : '');
      var cd = s.def > d.def ? ' up' : (s.def < d.def ? ' dn' : '');
      face = '<span class="face"><span class="art">' + d.glyph + '</span><span class="nm">' + esc(d.name) + '</span>' +
        '<span class="sts"><b class="a' + ca + (m.pos === 'atk' ? ' on' : '') + '">' + s.atk + '</b><b class="d' + cd + (m.pos === 'def' ? ' on' : '') + '">' + s.def + '</b></span></span>';
    }
    var label = m.faceDown && pi === FOE ? 'Face-down monster' : d.name + ', ' + s.atk + ' attack, ' + s.def + ' defense' + (m.pos === 'def' ? ', defense position' : '');
    return '<button class="' + cls + '" data-uid="' + m.uid + '" data-side="' + role(pi) + '" style="--h:' + d.hue + '" aria-label="' + esc(label) + '">' + face + '</button>';
  }

  function stCell(c, pi, isField) {
    var d = CARDS[c.id];
    var sel = ui.focus && ui.focus.k === 'st' && ui.focus.uid === c.uid;
    var cls = 'st ' + (pi === ME ? 'mine' : 'foe') + (c.faceDown ? ' fd' : '') + (isField ? ' fieldz' : '') + (sel ? ' sel' : '');
    var face;
    if (c.faceDown && pi === FOE) face = '<span class="face back"><span class="art">裏</span></span>';
    else if (c.faceDown) face = '<span class="face setcard"><span class="art">' + d.glyph + '</span><span class="stag">SET</span></span>';
    else face = '<span class="face"><span class="art">' + d.glyph + '</span></span>';
    return '<button class="' + cls + '" data-stuid="' + c.uid + '" data-side="' + role(pi) + '" style="--h:' + d.hue + '" aria-label="' +
      (c.faceDown && pi === FOE ? 'Set card' : esc(d.name)) + '">' + face + '</button>';
  }

  function renderZones(pi) {
    var p = G.players[pi], i;
    var st = '';
    for (i = 0; i < TC.RULES.MAX_ST; i++) st += p.st[i] ? stCell(p.st[i], pi, false) : '<span class="slot sts-slot"></span>';
    st += p.field ? stCell({ uid: p.field.uid, id: p.field.id, faceDown: false }, pi, true) : '<span class="slot sts-slot field-slot">場</span>';
    document.getElementById('st-' + role(pi)).innerHTML = st;
    var mons = '';
    for (i = 0; i < TC.RULES.MAX_MON; i++) mons += p.mon[i] ? monCell(p.mon[i], pi) : '<span class="slot mon-slot"></span>';
    document.getElementById('mon-' + role(pi)).innerHTML = mons;
  }

  function handCard(c, i, acts) {
    var d = CARDS[c.id];
    var playable = acts.some(function (a) { return a.idx === i; });
    var sel = ui.focus && ui.focus.k === 'hand' && ui.focus.uid === c.uid;
    var disc = G.pending && G.pending.kind === 'discard' && G.pending.pi === ME;
    var cls = 'card ' + d.type + (playable || disc ? '' : ' dim') + (sel ? ' sel' : '');
    var foot;
    if (d.type === 'monster') foot = '<span class="sts"><b class="a">' + d.atk + '</b><b class="d">' + d.def + '</b></span>';
    else foot = '<span class="stype">' + (d.type === 'trap' ? (d.sub === 'counter' ? 'COUNTER' : 'TRAP') : d.sub.toUpperCase()) + '</span>';
    var stars = d.type === 'monster' ? '<span class="lvl">' + 'Lv' + d.lv + '</span>' : '';
    return '<button class="' + cls + '" data-cuid="' + c.uid + '" style="--h:' + d.hue + '" aria-label="' + esc(d.name) + '">' +
      stars + '<span class="art" aria-hidden="true">' + d.glyph + '</span><span class="nm">' + esc(d.name) + '</span>' + foot + '</button>';
  }

  function renderHand() {
    var h = G.players[ME].hand, el = $('#hand');
    var acts = myActs();
    if (!h.length) { el.innerHTML = '<p class="empty">Your hand is empty.</p>'; return; }
    el.innerHTML = h.map(function (c, i) { return handCard(c, i, acts); }).join('');
  }

  // ----- details panel -----
  function statLine(d, m, pi) {
    if (d.type !== 'monster') return '';
    var s = m ? stats(pi, m) : { atk: d.atk, def: d.def };
    var pos = m ? (m.pos === 'atk' ? ' · Attack Position' : ' · Defense Position') : '';
    return 'Level ' + d.lv + ' · ATK ' + s.atk + ' / DEF ' + s.def + pos;
  }
  function cardInfo(d, m, pi) {
    var tag = d.type === 'monster' ? 'Monster' : d.type === 'trap' ? (d.sub === 'counter' ? 'Counter Trap' : 'Trap') : (d.sub === 'quick' ? 'Quick-Play' : d.sub === 'equip' ? 'Equip' : d.sub === 'field' ? 'Field' : d.sub === 'continuous' ? 'Continuous' : 'Spell');
    var html = '<div class="ihead"><b>' + esc(d.name) + '</b><span class="tag ' + d.type + '">' + tag + '</span></div>';
    var sl = statLine(d, m, pi);
    if (sl) html += '<div class="iline">' + sl + '</div>';
    if (d.type === 'monster') {
      var need = TC.requiredTributes(d.lv);
      if (need && !m) html += '<div class="iline">Needs ' + need + ' Tribute' + (need > 1 ? 's' : '') + '.</div>';
    }
    var kw = (d.kw || []).map(function (k) { return '<b>' + KW[k].label + '.</b> ' + KW[k].text; }).join(' ');
    if (kw) html += '<div class="itext">' + kw + '</div>';
    if (d.text) html += '<div class="itext">' + esc(d.text) + '</div>';
    return html;
  }

  function btn(act, label, cls) { return '<button class="abtn ' + (cls || '') + '" data-act="' + act + '">' + label + '</button>'; }

  function infoHTML() {
    if (G.over) return '<div class="log1">The duel is over.</div>';
    // modes
    var md = ui.mode;
    if (md) {
      var t;
      if (md.k === 'tribute') t = 'Choose ' + md.need + ' monster' + (md.need > 1 ? 's' : '') + ' to Tribute (' + md.chosen.length + '/' + md.need + ').';
      else if (md.k === 'target') t = 'Choose a target for ' + esc(CARDS[md.cardId].name) + '.';
      else t = 'Choose what ' + esc(CARDS[TC.findMon(G, md.uid) ? TC.findMon(G, md.uid).m.id : 'rival'].name) + ' attacks.' + (md.direct ? ' You may tap their Life Points.' : '');
      return '<div class="log1">' + t + '</div><div class="act">' + btn('cancel', 'Cancel') + '</div>';
    }
    var pend = G.pending;
    if (pend && pend.pi === ME && pend.kind === 'discard') {
      var extra = '';
      if (ui.focus && ui.focus.k === 'hand' && handIndex(ui.focus.uid) >= 0) {
        extra = cardInfo(CARDS[G.players[ME].hand[handIndex(ui.focus.uid)].id]) + '<div class="act">' + btn('discard', 'Discard', 'danger') + '</div>';
      }
      return '<div class="log1">Hand limit: discard ' + pend.n + ' card' + (pend.n > 1 ? 's' : '') + '. Tap a card in your hand.</div>' + extra;
    }
    if (pend && pend.pi === FOE) return '<div class="log1">' + esc(G.foeName || 'Opponent') + ' is deciding...</div>';

    var f = ui.focus;
    if (f) {
      var acts = myActs(), html = '';
      if (f.k === 'hand') {
        var idx = handIndex(f.uid);
        if (idx >= 0) {
          var d = CARDS[G.players[ME].hand[idx].id];
          html = cardInfo(d);
          var mine2 = acts.filter(function (a) { return a.idx === idx; });
          var b = '';
          if (d.type === 'monster') {
            if (mine2.some(function (a) { return a.type === 'summon'; })) b += btn('summon', 'Summon');
            if (mine2.some(function (a) { return a.type === 'set'; })) b += btn('set', 'Set');
          } else if (d.type === 'spell') {
            if (mine2.some(function (a) { return a.type === 'cast'; })) b += btn('cast', 'Activate');
            if (mine2.some(function (a) { return a.type === 'set'; })) b += btn('set', 'Set');
          } else if (mine2.some(function (a) { return a.type === 'set'; })) b += btn('set', 'Set');
          html += b ? '<div class="act">' + b + '</div>' : '<div class="act"><span class="why">' + esc(TC.explain(G, ME, idx)) + '</span></div>';
          return html;
        }
        ui.focus = null;
      } else if (f.k === 'mon') {
        var fm = TC.findMon(G, f.uid);
        if (fm) {
          var m = fm.m, dd = CARDS[m.id];
          if (m.faceDown && fm.pi === FOE) return '<div class="ihead"><b>Face-down monster</b></div><div class="itext">It can be flipped face-up by attacking it or by a card effect.</div>';
          html = cardInfo(dd, m, fm.pi) + (m.faceDown ? '<div class="iline">Face-down (Set) in Defense Position.</div>' : '');
          if (fm.pi === ME) {
            var ba = '';
            if (acts.some(function (a) { return a.type === 'attack' && a.uid === m.uid; })) ba += btn('attackmode', 'Attack');
            if (acts.some(function (a) { return a.type === 'flip' && a.uid === m.uid; })) ba += btn('flipsum', 'Flip Summon');
            if (acts.some(function (a) { return a.type === 'pos' && a.uid === m.uid; })) ba += btn('pos', m.pos === 'atk' ? 'To Defense' : 'To Attack');
            html += ba ? '<div class="act">' + ba + '</div>' : '';
          }
          return html;
        }
        ui.focus = null;
      } else if (f.k === 'st') {
        var sc = stCard(f.uid);
        if (sc) {
          if (sc.c.faceDown && sc.pi === FOE) return '<div class="ihead"><b>Set card</b></div><div class="itext">A face-down Spell or Trap.</div>';
          var sd = CARDS[sc.c.id];
          html = cardInfo(sd) + (sc.c.faceDown ? '<div class="iline">Set face-down.</div>' : '');
          if (sc.pi === ME && sc.c.faceDown && acts.some(function (a) { return a.type === 'castSet' && a.uid === sc.c.uid; })) html += '<div class="act">' + btn('castset', 'Activate') + '</div>';
          else if (sc.pi === ME && sc.c.faceDown && sd.type === 'trap') html += '<div class="iline">Traps activate when your opponent attacks or Summons (not the turn they are Set).</div>';
          return html;
        }
        ui.focus = null;
      }
    }
    var lines = G.log.slice(-3).reverse();
    return lines.map(function (l, i) { return '<div class="' + (i === 0 ? 'log1' : 'log2') + '">' + esc(l) + '</div>'; }).join('');
  }

  function renderMid() {
    var acts = myActs();
    var canBattle = acts.some(function (a) { return a.type === 'phase' && a.to === 'battle'; });
    var canM2 = acts.some(function (a) { return a.type === 'phase' && a.to === 'main2'; });
    var canEnd = acts.some(function (a) { return a.type === 'end'; });
    var ctl;
    if (!mine() || (G.pending && G.pending.kind === 'discard' && G.pending.pi === ME)) {
      ctl = '<button class="end wait" disabled>' + (G.over ? 'Over' : (G.online ? 'Waiting' : 'Opponent')) + '</button>';
    } else {
      var primary = canBattle ? btn('phase-battle', 'Battle', 'end') : canM2 ? btn('phase-main2', 'Main 2', 'end') : btn('end', 'End turn', 'end');
      var second = (canBattle || canM2) && canEnd ? btn('end', 'End turn', 'end2') : '';
      ctl = primary + second;
    }
    var ph = ['main1', 'battle', 'main2'].map(function (p, i) {
      return '<i class="' + (G.phase === p && !G.over ? 'on' : '') + '">' + ['M1', 'BP', 'M2'][i] + '</i>';
    }).join('');
    var who = G.over ? 'Duel over' : (G.turn === ME ? 'Your turn ' : (G.online ? 'Their turn ' : 'Opponent turn ')) + G.turnCount;
    $('#mid').innerHTML = '<div class="info" aria-live="polite">' + infoHTML() + '</div>' +
      '<div class="ctl"><div class="phase" title="' + phaseName(G.phase) + '"><span class="who">' + who + '</span><span class="pills">' + ph + '</span></div>' + ctl + '</div>';
  }

  // ----- response prompt (chains) -----
  function rootCtx(ctx) { while (ctx && ctx.parent) ctx = ctx.parent; return ctx; }
  function linkLabel(l) {
    var d = CARDS[l.id];
    var tn = '';
    if (l.target !== undefined && l.target !== null && typeof l.target === 'number') {
      var tf = TC.findMon(G, l.target);
      if (tf) tn = ' on ' + (tf.m.faceDown && tf.pi === FOE ? 'a face-down monster' : CARDS[tf.m.id].name);
    }
    return (l.pi === ME ? 'You: ' : 'Opponent: ') + d.name + (l.kind === 'mon' ? ' (' + (l.on === 'flip' ? 'Flip' : 'Debut') + ')' : '') + tn;
  }
  function renderPrompt() {
    var el = $('#prompt');
    var pend = G.pending;
    if (G.over || !pend || pend.pi !== ME || pend.kind !== 'respond') { el.hidden = true; return; }
    var ch = G.chain || { links: [] };
    var root = rootCtx(pend.ctx), title, body;
    if (ch.links.length) {
      var last = ch.links[ch.links.length - 1];
      title = last.pi === ME ? 'Your card is on the chain' : 'Opponent activates ' + CARDS[last.id].name + '!';
      body = esc(CARDS[last.id].text || '');
    } else if (root.kind === 'attack') {
      var af = TC.findMon(G, root.attUid);
      var an = af ? CARDS[af.m.id].name + ' (' + stats(FOE, af.m).atk + ' ATK)' : 'A monster';
      var tn;
      if (root.target.type === 'direct') tn = 'you directly';
      else { var tf = TC.findMon(G, root.target.uid); tn = tf ? (tf.m.faceDown ? 'your face-down ' + CARDS[tf.m.id].name : CARDS[tf.m.id].name) : 'a monster'; }
      title = 'Opponent attacks!';
      body = esc(an) + ' attacks ' + esc(tn) + '.';
    } else if (root.kind === 'summon') {
      var sf = TC.findMon(G, root.muid);
      title = root.mode === 'flip' ? 'Opponent Flip Summoned' : 'Opponent Summoned a monster';
      body = sf ? esc(CARDS[sf.m.id].name) + ' (' + stats(FOE, sf.m).atk + ' ATK) came out.' : 'A monster came out.';
    } else {
      title = 'Respond?'; body = '';
    }
    var chainHtml = ch.links.length
      ? '<div class="chain"><div class="lbl">Chain</div>' + ch.links.map(function (l, i) { return '<div class="clink">' + (i + 1) + '. ' + esc(linkLabel(l)) + '</div>'; }).join('') +
        '<div class="note">Last link resolves first.</div></div>' : '';
    var opts = pend.options.map(function (o) {
      var c = stCard(o.uid).c, d = CARDS[c.id];
      var tgt = '';
      if (o.target !== undefined && o.target !== null) {
        var tf2 = TC.findMon(G, o.target);
        if (tf2) tgt = ' → ' + (tf2.m.faceDown && tf2.pi === FOE ? 'face-down monster' : CARDS[tf2.m.id].name);
      }
      return '<button class="opt" data-act="respond" data-ruid="' + o.uid + '"' + (o.target !== undefined && o.target !== null ? ' data-rtgt="' + o.target + '"' : '') +
        ' style="--h:' + d.hue + '"><span class="chip">' + d.glyph + '</span><span class="otxt"><b>' + esc(d.name) + esc(tgt) + '</b><small>' + esc(d.text) + '</small></span></button>';
    }).join('');
    el.innerHTML = '<div class="sheet2" role="dialog" aria-label="Respond"><h3>' + esc(title) + '</h3>' + (body ? '<p>' + body + '</p>' : '') + chainHtml +
      '<div class="opts">' + opts + '</div><button class="ghost-btn" data-act="pass">' + (ch.links.length ? 'Let it resolve' : 'Do nothing') + '</button></div>';
    el.hidden = false;
  }

  // ----- floating numbers, toasts -----
  function toast(text, cls) {
    var layer = $('#toasts');
    var s = document.createElement('div');
    s.className = 'toast' + (cls ? ' ' + cls : '');
    s.textContent = text;
    layer.appendChild(s);
    while (layer.children.length > 2) layer.removeChild(layer.firstChild);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 2600);
  }
  function flushEvents() {
    var evs = G.events; G.events = [];
    var layer = $('#fx');
    evs.forEach(function (e) {
      if (e.t === 'fx') { toast(e.text, e.pi === ME ? 'mine' : 'foe'); return; }
      if (e.t === 'cast' && e.pi === FOE) { toast('Opponent activates ' + CARDS[e.id].name + '.', 'foe'); return; }
      if (e.t !== 'dmg' && e.t !== 'heal') return;
      var el = document.getElementById('bar-' + role(e.pi));
      if (!el) return;
      var r = el.getBoundingClientRect();
      var s = document.createElement('span');
      s.className = 'pop ' + (e.t === 'heal' ? 'heal' : 'dmg');
      s.textContent = (e.t === 'heal' ? '+' : '-') + e.n;
      s.style.left = (r.left + r.width * 0.72) + 'px';
      s.style.top = (r.top + r.height / 2) + 'px';
      layer.appendChild(s);
      setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 1100);
    });
  }

  // ----- end of duel -----
  function checkOver() {
    if (!G || !G.over) return;
    var broken = G.reason === 'disconnect' || G.reason === 'desync';
    if (!G.recorded && !broken) {
      G.recorded = true;
      var r = readRecord();
      if (G.winner === ME) r.w++; else if (G.winner === FOE) r.l++; else r.d++;
      writeRecord(r);
    }
    var won = G.winner === ME, lost = G.winner === FOE;
    var title = broken ? (G.reason === 'desync' ? 'Out of sync' : 'Disconnected') : won ? 'Victory' : lost ? 'Defeat' : 'Draw';
    var sub;
    if (G.reason === 'disconnect') sub = 'The connection to your opponent was lost. The duel cannot continue.';
    else if (G.reason === 'desync') sub = 'The two games stopped matching, so the duel was ended. Start a new one.';
    else if (G.reason === 'resign') sub = won ? 'Your opponent left the duel.' : 'You left the duel.';
    else if (G.reason === 'deck') sub = won ? 'Your opponent ran out of cards to draw.' : 'You ran out of cards to draw.';
    else sub = won ? 'The power of friendship holds. Turn ' + G.turnCount + '.' : lost ? 'This is the part where you train and come back stronger.' : 'Both Life Points hit zero at once.';
    $('#over-title').textContent = title;
    $('#over-sub').textContent = (TCUI.rematchNote && online && !broken ? TCUI.rematchNote() : '') || sub;
    var again = $('#over [data-act=again]');
    if (again) { again.textContent = online ? 'Rematch' : 'Play again'; again.hidden = !!(online && broken); }
    $('#over').hidden = false;
  }

  // ---------- doing things ----------
  function perform(a) {
    if (online && !mine()) return false;
    var ok = TC.doAction(G, a);
    if (ok && online) netSend({ t: 'move', n: online.moveN++, a: a, h: stateHash(G) });
    ui.mode = null; ui.focus = null;
    render();
    drive();
    return ok;
  }

  function drive() {
    if (!G || G.over || online || decider() !== FOE || aiBusy) return;
    aiBusy = true;
    var n = 0;
    (function step() {
      setTimeout(function () {
        if (!G || G.over || decider() !== FOE) { aiBusy = false; if (G) render(); return; }
        var a = TC.aiStep(G);
        if (++n > 150) a = { type: 'end' };
        if (!TC.doAction(G, a)) TC.doAction(G, { type: 'end' });
        render();
        if (G && !G.over && decider() === FOE) step(); else aiBusy = false;
      }, G.pending ? 600 : 750);
    })();
  }

  function focusHandAction(kind) {
    if (!ui.focus || ui.focus.k !== 'hand') return;
    var idx = handIndex(ui.focus.uid);
    if (idx < 0) return;
    var d = CARDS[G.players[ME].hand[idx].id];
    var acts = myActs().filter(function (a) { return a.idx === idx && (kind === 'cast' ? a.type === 'cast' : a.type === kind); });
    if (!acts.length) return;
    if (kind === 'cast') {
      if (acts[0].target === undefined) { perform(acts[0]); return; }
      ui.mode = { k: 'target', cardId: G.players[ME].hand[idx].id, idx: idx, act: 'cast', valid: acts.map(function (a) { return a.target; }) };
      render();
      return;
    }
    // summon / set
    var need = acts[0].tributes ? acts[0].tributes.length : 0;
    if (!need) { perform(acts[0]); return; }
    ui.mode = { k: 'tribute', idx: idx, type: kind, need: need, chosen: [] };
    render();
  }

  function onHandTap(uid) {
    if (G.pending && G.pending.pi === ME && G.pending.kind === 'discard') {
      ui.focus = { k: 'hand', uid: uid }; ui.mode = null; render(); return;
    }
    var same = ui.focus && ui.focus.k === 'hand' && ui.focus.uid === uid;
    ui.mode = null;
    ui.focus = same ? null : { k: 'hand', uid: uid };
    render();
  }

  function onMonTap(uid) {
    var f = TC.findMon(G, uid);
    if (!f) return;
    var md = ui.mode;
    if (md) {
      if (md.k === 'tribute' && f.pi === ME) {
        var i = md.chosen.indexOf(uid);
        if (i >= 0) md.chosen.splice(i, 1); else md.chosen.push(uid);
        if (md.chosen.length === md.need) {
          var a = { type: md.type, idx: md.idx, tributes: md.chosen.slice() };
          if (!TC.legalActions(G, ME).some(function (x) { return TC.actionKey(x) === TC.actionKey(a); })) { md.chosen = []; render(); return; }
          perform(a);
          return;
        }
        render(); return;
      }
      if (md.k === 'target' && md.valid.indexOf(uid) >= 0) {
        perform(md.act === 'cast' ? { type: 'cast', idx: md.idx, target: uid } : { type: 'castSet', uid: md.suid, target: uid });
        return;
      }
      if (md.k === 'attack' && f.pi === FOE && md.mons.indexOf(uid) >= 0) {
        perform({ type: 'attack', uid: md.uid, target: { type: 'mon', uid: uid } });
        return;
      }
      ui.mode = null;
    }
    if (f.pi === ME && mine() && G.phase === 'battle') {
      var atk = myActs().filter(function (a) { return a.type === 'attack' && a.uid === uid; });
      if (atk.length) {
        ui.focus = { k: 'mon', uid: uid };
        ui.mode = { k: 'attack', uid: uid, direct: atk.some(function (a) { return a.target.type === 'direct'; }),
          mons: atk.filter(function (a) { return a.target.type === 'mon'; }).map(function (a) { return a.target.uid; }) };
        render(); return;
      }
    }
    var same = ui.focus && ui.focus.k === 'mon' && ui.focus.uid === uid;
    ui.focus = same ? null : { k: 'mon', uid: uid };
    render();
  }

  function onStTap(uid) {
    ui.mode = null;
    var same = ui.focus && ui.focus.k === 'st' && ui.focus.uid === uid;
    ui.focus = same ? null : { k: 'st', uid: uid };
    render();
  }

  function onHeroTap(pi) {
    var md = ui.mode;
    if (pi === 1 && md && md.k === 'attack' && md.direct) perform({ type: 'attack', uid: md.uid, target: { type: 'direct' } });
  }

  function openModal(html) {
    $('#modal-body').innerHTML = html;
    $('#modal').hidden = false;
  }

  function openGrave(pi) {
    var p = G.players[pi];
    var rows = p.gy.length ? p.gy.map(function (id) {
      var d = CARDS[id];
      return '<div class="grow" style="--h:' + d.hue + '"><span class="chip">' + d.glyph + '</span><span class="gtxt"><b>' + esc(d.name) + '</b><small>' +
        (d.type === 'monster' ? 'Lv' + d.lv + ' · ' + d.atk + ' / ' + d.def : (d.type === 'trap' ? 'Trap' : 'Spell')) + '</small></span></div>';
    }).reverse().join('') : '<p class="empty">Nothing here yet.</p>';
    openModal('<h3>' + (pi === ME ? 'Your' : (online ? G.foeName : 'Opponent') + '\'s') + ' Graveyard (' + p.gy.length + ')</h3><div class="glist">' + rows + '</div>');
  }
  function openLog() {
    var rows = G.log.slice(-40).reverse().map(function (l) { return '<div class="lrow">' + esc(l) + '</div>'; }).join('');
    openModal('<h3>Duel log</h3><div class="glist">' + rows + '</div>');
  }

  // ---------- clicks ----------
  document.addEventListener('click', function (e) {
    if (!G) return;
    var t = e.target.closest('[data-act],[data-cuid],[data-uid],[data-stuid],[data-gy],[data-hero]');
    if (!t || t.closest('#menu, #decks-screen, #editor')) return;

    if (t.hasAttribute('data-act')) {
      var act = t.getAttribute('data-act');
      switch (act) {
        case 'summon': case 'set': case 'cast': focusHandAction(act); break;
        case 'castset': {
          var sc = ui.focus && ui.focus.k === 'st' ? stCard(ui.focus.uid) : null;
          if (!sc) break;
          var acts = myActs().filter(function (a) { return a.type === 'castSet' && a.uid === sc.c.uid; });
          if (!acts.length) break;
          if (acts[0].target === undefined) perform(acts[0]);
          else { ui.mode = { k: 'target', cardId: sc.c.id, act: 'castSet', suid: sc.c.uid, valid: acts.map(function (a) { return a.target; }) }; render(); }
          break;
        }
        case 'flipsum': if (ui.focus && ui.focus.k === 'mon') perform({ type: 'flip', uid: ui.focus.uid }); break;
        case 'pos': if (ui.focus && ui.focus.k === 'mon') perform({ type: 'pos', uid: ui.focus.uid }); break;
        case 'attackmode': {
          if (!ui.focus || ui.focus.k !== 'mon') break;
          var atk = myActs().filter(function (a) { return a.type === 'attack' && a.uid === ui.focus.uid; });
          if (atk.length) {
            ui.mode = { k: 'attack', uid: ui.focus.uid, direct: atk.some(function (a) { return a.target.type === 'direct'; }),
              mons: atk.filter(function (a) { return a.target.type === 'mon'; }).map(function (a) { return a.target.uid; }) };
            render();
          }
          break;
        }
        case 'cancel': ui.mode = null; render(); break;
        case 'discard':
          if (ui.focus && ui.focus.k === 'hand') { var di = handIndex(ui.focus.uid); if (di >= 0) perform({ type: 'discard', idx: di }); }
          break;
        case 'phase-battle': perform({ type: 'phase', to: 'battle' }); break;
        case 'phase-main2': perform({ type: 'phase', to: 'main2' }); break;
        case 'end': perform({ type: 'end' }); break;
        case 'respond': {
          var ra = { type: 'respond', uid: parseInt(t.getAttribute('data-ruid'), 10) };
          if (t.hasAttribute('data-rtgt')) ra.target = parseInt(t.getAttribute('data-rtgt'), 10);
          perform(ra);
          break;
        }
        case 'pass': perform({ type: 'respond', uid: null }); break;
        case 'log': openLog(); break;
        case 'quit':
          if (quitArm) {
            clearTimeout(quitTimer); quitArm = false;
            if (online && !G.over) {                       // leaving an online duel counts as a loss
              netSend({ t: 'resign' });
              var rr = readRecord(); rr.l++; writeRecord(rr);
            }
            if (TCUI.online && online) TCUI.online.leave();
            TCUI.duel.stop(); TCUI.go('menu');
          }
          else { quitArm = true; render(); quitTimer = setTimeout(function () { quitArm = false; if (G) render(); }, 2500); }
          break;
      }
      return;
    }
    if (t.hasAttribute('data-gy')) { openGrave(parseInt(t.getAttribute('data-gy'), 10)); return; }
    if (t.hasAttribute('data-cuid')) { onHandTap(parseInt(t.getAttribute('data-cuid'), 10)); return; }
    if (t.hasAttribute('data-uid')) { onMonTap(parseInt(t.getAttribute('data-uid'), 10)); return; }
    if (t.hasAttribute('data-stuid')) { onStTap(parseInt(t.getAttribute('data-stuid'), 10)); return; }
    if (t.hasAttribute('data-hero')) { onHeroTap(parseInt(t.getAttribute('data-hero'), 10)); }
  });

  // test hook
  TCUI._test = { G: function () { return G; }, mine: mine, decider: decider, me: function () { return ME; }, hash: function () { return stateHash(G); } };
})();
