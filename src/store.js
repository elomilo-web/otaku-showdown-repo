/*
  Deck storage. Custom decks live in this browser (localStorage) and, when the page can run the
  db + user capabilities, are also saved to the viewer's private account storage so they follow
  the player across devices. If either is unavailable the game keeps working from what it has.
  Every deck: { id, name, cards: { cardId: count } }.
*/
var TCUI = (typeof TCUI === 'undefined') ? {} : TCUI;

(function () {
  var KEY = 'trope-clash-decks-v2';
  var SEL = 'trope-clash-selected-deck';
  var state = { decks: [], selected: 'preset:rush', cloud: false };
  var listeners = [];
  var doc = null, writing = false, dirty = false, timer = null;

  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); }

  function clean(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (d) {
      if (!d || typeof d.id !== 'string' || typeof d.cards !== 'object' || !d.cards) return;
      var cards = {};
      for (var k in d.cards) {
        var n = d.cards[k] | 0;
        if (TC.CARDS[k] && n > 0) cards[k] = Math.min(n, 60);
      }
      out.push({ id: d.id, name: String(d.name || 'Untitled deck').slice(0, 24), cards: cards });
    });
    return out.slice(0, 40);
  }

  function readLocal() {
    try {
      var r = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (r && r.decks) state.decks = clean(r.decks);
    } catch (e) { /* storage unavailable */ }
    try {
      var s = localStorage.getItem(SEL);
      if (s) state.selected = s;
    } catch (e) { /* ignore */ }
  }
  function writeLocal() {
    try { localStorage.setItem(KEY, JSON.stringify({ decks: state.decks })); } catch (e) { /* ignore */ }
  }

  function flush() {
    if (!doc || !dirty) return;
    if (writing) { setTimeout(flush, 300); return; }
    dirty = false; writing = true;
    var snapshot = JSON.stringify({ v: 2, decks: state.decks });
    doc.set(JSON.parse(snapshot)).then(function () { writing = false; if (dirty) flush(); },
      function () { writing = false; /* keep the local copy; try again on the next change */ });
  }
  function persist() {
    writeLocal();
    if (!doc) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  }

  async function initCloud() {
    try {
      if (!window.claude || !window.claude.use) return;
      var user = await window.claude.use('user');
      var db = await window.claude.use('db');
      if (!user || !db) return;
      var id = await user.id();
      if (!id) return;
      var ref = db.doc('data/users/' + id + '/decks');
      var snap = await ref.get();
      if (snap.exists) {
        var data = snap.data();
        if (data && Array.isArray(data.decks)) {
          state.decks = clean(data.decks);
          writeLocal();
        }
      } else if (state.decks.length) {
        await ref.set({ v: 2, decks: JSON.parse(JSON.stringify(state.decks)) });
      }
      doc = ref;
      state.cloud = true;
      emit();
    } catch (e) { /* stay on local storage */ }
  }

  function newId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  var S = {
    presets: function () { return TC.PRESETS; },
    custom: function () { return state.decks; },
    all: function () { return TC.PRESETS.concat(state.decks); },
    get: function (id) {
      var p = TC.presetById(id);
      if (p) return p;
      for (var i = 0; i < state.decks.length; i++) if (state.decks[i].id === id) return state.decks[i];
      return null;
    },
    isCloud: function () { return state.cloud; },
    selectedId: function () {
      var d = S.get(state.selected);
      if (d && TC.validateDeck(d.cards).ok) return d.id;
      return TC.PRESETS[0].id;
    },
    select: function (id) {
      state.selected = id;
      try { localStorage.setItem(SEL, id); } catch (e) { /* ignore */ }
    },
    create: function (name, cards) {
      var d = { id: newId(), name: (name || 'New deck').slice(0, 24), cards: cards ? JSON.parse(JSON.stringify(cards)) : {} };
      state.decks.push(d);
      persist(); emit();
      return d;
    },
    // save changes to a custom deck that was edited in place
    touch: function () { persist(); },
    remove: function (id) {
      state.decks = state.decks.filter(function (d) { return d.id !== id; });
      if (state.selected === id) S.select(TC.PRESETS[0].id);
      persist(); emit();
    },
    onChange: function (f) { listeners.push(f); },

    // share codes: base64 of a small JSON document
    encode: function (deck) {
      var json = JSON.stringify({ n: deck.name, c: deck.cards });
      return 'TC1:' + btoa(unescape(encodeURIComponent(json)));
    },
    decode: function (code) {
      try {
        code = String(code || '').trim();
        if (code.indexOf('TC1:') !== 0) return null;
        var o = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
        var cleaned = clean([{ id: 'x', name: o.n, cards: o.c }])[0];
        return cleaned ? { name: cleaned.name, cards: cleaned.cards } : null;
      } catch (e) { return null; }
    }
  };

  readLocal();
  TCUI.store = S;
  TCUI.initStore = initCloud;
})();
