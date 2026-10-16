var TCUI = (typeof TCUI === 'undefined') ? {} : TCUI;

/* Menu, screen routing, boot, hot-reload snapshot. */
(function () {
  'use strict';
  var screen = 'menu';
  var SCREENS = { menu: 'menu', decks: 'decks-screen', editor: 'editor', online: 'online', game: 'game' };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  TCUI.go = function (name) {
    screen = name;
    for (var k in SCREENS) document.getElementById(SCREENS[k]).hidden = (k !== name);
    if (name !== 'game') { document.getElementById('over').hidden = true; document.getElementById('prompt').hidden = true; }
    if (name === 'menu') renderMenu();
    if (name === 'decks') TCUI.editor.showList();
    if (name === 'editor') TCUI.editor.show();
    if (name === 'online') TCUI.online.show();
    window.scrollTo(0, 0);
  };

  function renderMenu() {
    var S = TCUI.store, sel = S.selectedId();
    var html = S.all().map(function (d) {
      var v = TC.validateDeck(d.cards);
      var glyph = d.glyph || '札', hue = d.hue !== undefined ? d.hue : 220;
      return '<button class="deck' + (d.id === sel ? ' on' : '') + '" data-m="pick" data-id="' + d.id + '"' + (v.ok ? '' : ' disabled') + ' aria-pressed="' + (d.id === sel) + '">' +
        '<span class="disc" style="--h:' + hue + '">' + glyph + '</span>' +
        '<span class="dtxt"><b>' + esc(d.name) + '</b><small>' + (d.blurb ? esc(d.blurb) : TC.deckCount(d.cards) + ' cards') + (v.ok ? '' : ' · not valid') + '</small></span>' +
        '<span>' + (d.id === sel ? '✔' : '') + '</span></button>';
    }).join('');
    document.getElementById('menu-decks').innerHTML = html;
    document.getElementById('record').textContent = TCUI.recordText();
  }

  function startDuel() {
    var d = TCUI.store.get(TCUI.store.selectedId());
    TCUI.go('game');
    TCUI.duel.start(d.cards);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-m],[data-act]');
    if (!t) return;
    var m = t.getAttribute('data-m');
    if (m === 'pick') { TCUI.store.select(t.getAttribute('data-id')); renderMenu(); return; }
    var a = t.getAttribute('data-act');
    if (a === 'again' && TCUI.duel.isOnline()) TCUI.online.rematch();
    else if (a === 'duel' || a === 'again') { document.getElementById('over').hidden = true; startDuel(); }
    else if (a === 'goonline') TCUI.go('online');
    else if (a === 'godecks') TCUI.go('decks');
    else if (a === 'tomenu') { if (TCUI.duel.isOnline()) TCUI.online.leave(); TCUI.duel.stop(); TCUI.go('menu'); }
    else if (a === 'closemodal') {
      if (t.id === 'modal' && e.target !== t) return;
      document.getElementById('modal').hidden = true;
    }
  });

  function boot(data) {
    TCUI.store.onChange(function () { if (screen === 'menu') renderMenu(); });
    var g = data && data.G;
    if (g && data.screen === 'game' && g.players && !g.over) {
      TCUI.go('game');
      TCUI.duel.resume(g);
    } else {
      TCUI.go(data && data.screen === 'decks' ? 'decks' : 'menu');
    }
    TCUI.initStore().then(function () { if (screen === 'menu') renderMenu(); else if (screen === 'decks') TCUI.editor.showList(); });
    var hot = window.claude && window.claude.hot;
    if (hot && hot.snapshot) hot.snapshot(function () { return { G: TCUI.duel.isOnline() ? null : TCUI.duel.state(), screen: screen === 'editor' ? 'decks' : screen }; });
  }

  var hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
})();
