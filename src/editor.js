var TCUI = (typeof TCUI === 'undefined') ? {} : TCUI;

/* Deck list + deck editor. Custom decks auto-save through TCUI.store. */
(function () {
  'use strict';
  var CARDS = TC.CARDS, S = null;
  var E = { deck: null, filter: 'all', set: 'all', search: '', open: null, sheet: null, armDel: null, msg: '' };
  var armTimer = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function listEl() { return document.getElementById('decks-screen'); }
  function edEl() { return document.getElementById('editor'); }

  function deckRow(d, extra) {
    var v = TC.validateDeck(d.cards);
    var n = TC.deckCount(d.cards);
    var glyph = d.glyph || (function () {
      var best = null, bc = 0;
      for (var k in d.cards) if (CARDS[k].type === 'monster' && d.cards[k] * 1000 + CARDS[k].atk > bc) { bc = d.cards[k] * 1000 + CARDS[k].atk; best = k; }
      return best ? CARDS[best].glyph : '札';
    })();
    var hue = d.hue !== undefined ? d.hue : 220;
    return '<div class="deck' + (v.ok ? '' : ' bad') + '"><span class="disc" style="--h:' + hue + '">' + glyph + '</span>' +
      '<span class="dtxt"><b>' + esc(d.name) + '</b><small>' + n + ' cards · ' + (v.ok ? '<span class="ok">Valid</span>' : '<span class="badtxt">Not valid</span>') + (d.preset ? ' · Preset' : '') + '</small></span>' +
      '<span class="row">' + extra + '</span></div>';
  }

  function renderList() {
    S = TCUI.store;
    var h = '<div class="row sp"><h2 class="title">Decks</h2><button class="sbtn" data-e="back">Back</button></div>' +
      '<p class="note">Decks hold 40 to 60 cards, up to 3 copies of a card unless the card says otherwise. Only valid decks can be used in a duel.' +
      (S.isCloud() ? ' Your decks are saved to your account.' : ' Your decks are saved in this browser.') + '</p>' +
      '<div class="row"><button class="sbtn flex" data-e="new">New deck</button><button class="sbtn flex" data-e="import">Import code</button></div>';
    if (E.sheet === 'import') h += importSheet();
    h += '<div class="lbl">Your decks</div><div class="list">';
    var cu = S.custom();
    if (!cu.length) h += '<p class="note">No custom decks yet. Make a new one, or copy a preset below.</p>';
    cu.forEach(function (d) {
      h += deckRow(d, '<button class="sbtn" data-e="edit" data-id="' + d.id + '">Edit</button>');
    });
    h += '</div><div class="lbl">Presets</div><div class="list">';
    S.presets().forEach(function (d) {
      h += deckRow(d, '<button class="sbtn" data-e="copy" data-id="' + d.id + '">Copy &amp; edit</button>');
    });
    h += '</div>';
    listEl().innerHTML = h;
  }

  function importSheet() {
    return '<div class="how" style="padding:12px"><div class="lbl">Paste a deck code</div>' +
      '<textarea id="imp" class="field" aria-label="Deck code" placeholder="TC1:..."></textarea>' +
      (E.msg ? '<p class="badtxt">' + esc(E.msg) + '</p>' : '') +
      '<div class="row" style="margin-top:8px"><button class="sbtn flex" data-e="doimport">Import</button><button class="sbtn" data-e="closesheet">Cancel</button></div></div>';
  }

  function matches(id) {
    var d = CARDS[id];
    if (E.filter !== 'all' && d.type !== E.filter) return false;
    if (E.set !== 'all' && d.set !== E.set) return false;
    if (E.search && d.name.toLowerCase().indexOf(E.search.toLowerCase()) < 0 && (d.text || '').toLowerCase().indexOf(E.search.toLowerCase()) < 0) return false;
    return true;
  }

  function cardRow(id) {
    var d = CARDS[id], n = E.deck.cards[id] || 0, lim = TC.limitOf(id), total = TC.deckCount(E.deck.cards);
    var sub = d.type === 'monster' ? 'Lv' + d.lv + ' · ATK ' + d.atk + ' / DEF ' + d.def : (d.type === 'trap' ? (d.sub === 'counter' ? 'Counter Trap' : 'Trap') : (d.sub.charAt(0).toUpperCase() + d.sub.slice(1) + ' Spell'));
    var kw = (d.kw || []).map(function (k) { return TC.KW[k].label; }).join(', ');
    var open = E.open === id;
    var desc = open ? '<div class="cdesc">' + esc([kw && kw + '.', d.text, d.type === 'monster' && TC.requiredTributes(d.lv) ? 'Needs ' + TC.requiredTributes(d.lv) + ' Tribute(s).' : ''].filter(Boolean).join(' ') || 'No effect.') + '</div>' : '';
    return '<div class="crow' + (n ? ' in' : '') + '" style="--h:' + d.hue + '"><div class="crow-main">' +
      '<span class="chip">' + d.glyph + '</span>' +
      '<button class="ctxt" data-e="info" data-id="' + id + '" aria-expanded="' + open + '"><b>' + esc(d.name) + '</b><small>' + sub + ' · max ' + lim + (TC.SET_ORDER.length > 1 ? ' · ' + esc(TC.SETS[d.set].name) : '') + '</small></button>' +
      '<span class="step"><button data-e="dec" data-id="' + id + '" aria-label="Remove ' + esc(d.name) + '"' + (n ? '' : ' disabled') + '>−</button><span class="n">' + n + '</span>' +
      '<button data-e="inc" data-id="' + id + '" aria-label="Add ' + esc(d.name) + '"' + (n >= lim || total >= TC.DECK_MAX ? ' disabled' : '') + '>+</button></span></div>' + desc + '</div>';
  }

  // one chip per set (only shown once there is more than one set)
  function setTabs() {
    if (TC.SET_ORDER.length < 2) return '';
    var h = '<div class="tabs" aria-label="Card sets"><button class="tab' + (E.set === 'all' ? ' on' : '') + '" data-e="set" data-f="all">All sets</button>';
    TC.SET_ORDER.forEach(function (id) {
      h += '<button class="tab' + (E.set === id ? ' on' : '') + '" data-e="set" data-f="' + id + '">' + esc(TC.SETS[id].name) + '</button>';
    });
    return h + '</div>';
  }

  function renderEditor() {
    var d = E.deck, v = TC.validateDeck(d.cards), n = v.count;
    var pct = Math.min(100, n / TC.DECK_MAX * 100);
    var h = '<div class="row sp"><button class="sbtn" data-e="tolist">Decks</button><span class="note">Saved automatically</span></div>' +
      '<input id="dname" class="field" maxlength="24" value="' + esc(d.name) + '" aria-label="Deck name">' +
      '<div class="countbar"><div class="row sp"><b>' + n + ' / ' + TC.DECK_MAX + ' cards</b><span class="' + (v.ok ? 'ok' : 'badtxt') + '">' + (v.ok ? 'Valid deck' : 'Needs ' + (n < TC.DECK_MIN ? (TC.DECK_MIN - n) + ' more' : 'fixing')) + '</span></div>' +
      '<div class="cb-track"><div class="cb-fill' + (v.ok ? ' ok' : '') + '" style="width:' + pct + '%"></div><span class="cb-min" title="Minimum 40"></span></div>' +
      (v.ok ? '' : '<div class="cb-errs">' + v.errors.map(esc).join(' ') + '</div>') + '</div>';
    h += '<div class="row"><button class="sbtn flex" data-e="share">Share code</button><button class="sbtn flex" data-e="clear">Clear</button>' +
      '<button class="sbtn danger" data-e="del">' + (E.armDel === d.id ? 'Sure?' : 'Delete') + '</button></div>';
    if (E.sheet === 'share') h += '<div class="how" style="padding:12px"><div class="lbl">Deck code (copy it)</div><textarea id="shr" class="field" readonly aria-label="Deck code">' + esc(S.encode(d)) + '</textarea>' +
      '<button class="sbtn" style="margin-top:8px" data-e="closesheet">Done</button></div>';
    h += '<div class="tabs">' + [['all', 'All'], ['monster', 'Monsters'], ['spell', 'Spells'], ['trap', 'Traps']].map(function (t) {
      return '<button class="tab' + (E.filter === t[0] ? ' on' : '') + '" data-e="filter" data-f="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>' +
      setTabs() +
      '<input id="dsearch" class="field" style="font-weight:500;font-size:0.9rem" placeholder="Search cards" value="' + esc(E.search) + '" aria-label="Search cards">' +
      '<div class="list" id="clist">' + TC.cardOrder().filter(matches).map(cardRow).join('') + '</div>';
    var ae = document.activeElement, keep = ae && ae.id, pos = ae && ae.selectionStart;
    var sy = window.scrollY;
    edEl().innerHTML = h;
    window.scrollTo(0, sy);
    if (keep === 'dsearch' || keep === 'dname') { var el = document.getElementById(keep); el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
  }

  // refresh only the parts that change when typing in search (keeps the keyboard open)
  function renderListOnly() {
    var c = document.getElementById('clist');
    if (c) c.innerHTML = TC.cardOrder().filter(matches).map(cardRow).join('');
  }

  function openEditor(id) {
    var d = S.get(id);
    if (!d || d.preset) return;
    E.deck = d; E.filter = 'all'; E.set = 'all'; E.search = ''; E.open = null; E.sheet = null; E.armDel = null;
    TCUI.go('editor');
  }

  TCUI.editor = {
    showList: function () { E.sheet = null; E.msg = ''; renderList(); },
    show: renderEditor
  };

  document.addEventListener('input', function (e) {
    if (!E.deck) return;
    if (e.target.id === 'dname') {
      E.deck.name = e.target.value.slice(0, 24) || 'Untitled deck';
      S.touch();
    } else if (e.target.id === 'dsearch') {
      E.search = e.target.value; renderListOnly();
    }
  });

  function onClick(e) {
    var t = e.target.closest('[data-e]');
    if (!t) return;
    S = TCUI.store;
    var a = t.getAttribute('data-e'), id = t.getAttribute('data-id');
    switch (a) {
      case 'back': TCUI.go('menu'); break;
      case 'new': openEditor(S.create('New deck', {}).id); break;
      case 'edit': openEditor(id); break;
      case 'copy': {
        var p = S.get(id);
        openEditor(S.create(p.name + ' copy', p.cards).id);
        break;
      }
      case 'import': E.sheet = 'import'; E.msg = ''; renderList(); break;
      case 'closesheet': E.sheet = null; if (!listEl().hidden) renderList(); else renderEditor(); break;
      case 'doimport': {
        var r = S.decode((document.getElementById('imp') || {}).value);
        if (!r) { E.msg = 'That code is not a valid deck code.'; renderList(); break; }
        E.sheet = null; E.msg = '';
        openEditor(S.create(r.name, r.cards).id);
        break;
      }
      case 'tolist': E.sheet = null; TCUI.go('decks'); break;
      case 'filter': E.filter = t.getAttribute('data-f'); renderEditor(); break;
      case 'set': E.set = t.getAttribute('data-f'); renderEditor(); break;
      case 'info': E.open = E.open === id ? null : id; renderEditor(); break;
      case 'inc': {
        var c = E.deck.cards;
        if ((c[id] || 0) < TC.limitOf(id) && TC.deckCount(c) < TC.DECK_MAX) { c[id] = (c[id] || 0) + 1; S.touch(); }
        renderEditor();
        break;
      }
      case 'dec': {
        var c2 = E.deck.cards;
        if (c2[id]) { c2[id]--; if (!c2[id]) delete c2[id]; S.touch(); }
        renderEditor();
        break;
      }
      case 'clear': E.deck.cards = {}; S.touch(); renderEditor(); break;
      case 'share': E.sheet = 'share'; renderEditor(); setTimeout(function () { var s = document.getElementById('shr'); if (s) { s.focus(); s.select(); } }, 0); break;
      case 'del':
        if (E.armDel === E.deck.id) { clearTimeout(armTimer); var did = E.deck.id; E.armDel = null; E.deck = null; S.remove(did); TCUI.go('decks'); }
        else { E.armDel = E.deck.id; renderEditor(); clearTimeout(armTimer); armTimer = setTimeout(function () { E.armDel = null; if (E.deck && !edEl().hidden) renderEditor(); }, 2500); }
        break;
    }
  }
  document.addEventListener('click', onClick);
})();
