var TCUI = (typeof TCUI === 'undefined') ? {} : TCUI;

/*
  Play a friend. A direct browser-to-browser connection (WebRTC data channel), set up by swapping two short
  codes through any chat app. No account, server or sharing level is needed beyond both players opening the page.
  Only moves travel over the connection; both browsers run the same engine from the same seed (see duel.js).

    host:  makes an invite code  ->  friend pastes it, gets a reply code  ->  host pastes the reply  ->  connected
*/
(function () {
  'use strict';
  var NAME_KEY = 'otaku-showdown-name';
  var ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
  TCUI.onlineIce = null;           // tests replace this ({ iceServers: [] }) so no network is needed

  var pc = null, ch = null, role = null, peer = null, started = false;
  var myRematch = false, peerRematch = false;
  var st = { step: 'home', code: '', reply: '', msg: '', busy: false };

  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el() { return document.getElementById('online'); }

  // ---------- name ----------
  function getName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
  function setName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* ignore */ } }
  function myName() { return (getName() || 'Friend').trim().slice(0, 16) || 'Friend'; }

  // ---------- codes ----------
  function b64u(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function streamBytes(bytes, stream) {
    var s = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function encodeCode(kind, obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj)), flag = 'p';
    if (typeof CompressionStream !== 'undefined') {
      try { bytes = await streamBytes(bytes, new CompressionStream('deflate-raw')); flag = 'z'; } catch (e) { flag = 'p'; bytes = new TextEncoder().encode(JSON.stringify(obj)); }
    }
    return 'OS1' + kind + ':' + flag + b64u(bytes);
  }
  async function decodeCode(text, kind) {
    var c = String(text || '').replace(/\s+/g, '');
    var m = /^OS1([oa]):([zp])(.+)$/.exec(c);
    if (!m) throw new Error('That does not look like a game code. Copy the whole code, starting with OS1.');
    if (m[1] !== kind) throw new Error(kind === 'o' ? 'That is a reply code. Paste the invite code your friend sent you.' : 'That is an invite code. Paste the reply code your friend sent back.');
    var bytes = unb64u(m[3]);
    if (m[2] === 'z') {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read that code.');
      bytes = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
    }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new Error('That code is damaged. Copy it again.'); }
  }

  // ---------- connection ----------
  function newPC() {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('Online play is not available in this browser.');
    var p = new RTCPeerConnection(TCUI.onlineIce || ICE);
    p.onconnectionstatechange = function () {
      if (p !== pc) return;
      if (p.connectionState === 'failed') lost('The connection could not be made or was lost. Try again, or check that you both have internet.');
    };
    return p;
  }
  function gathered(p) {
    return new Promise(function (resolve) {
      if (p.iceGatheringState === 'complete') { resolve(); return; }
      var done = false;
      function fin() { if (!done) { done = true; resolve(); } }
      p.addEventListener('icegatheringstatechange', function () { if (p.iceGatheringState === 'complete') fin(); });
      setTimeout(fin, 6000);
    });
  }
  function wire(c) {
    ch = c;
    c.onopen = function () { send({ t: 'hello', v: TC.contentHash(), name: myName(), deck: selectedDeck() }); };
    c.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } onMessage(m); };
    c.onclose = function () { lost('Your friend disconnected.'); };
  }
  function send(m) { if (ch && ch.readyState === 'open') ch.send(JSON.stringify(m)); }
  function close() {
    try { if (ch) { ch.onclose = null; ch.close(); } } catch (e) { /* ignore */ }
    try { if (pc) { pc.onconnectionstatechange = null; pc.close(); } } catch (e) { /* ignore */ }
    pc = null; ch = null;
  }
  function lost(msg) {
    if (started) { TCUI.duel.netLost(); return; }
    if (st.step === 'home') return;
    st.step = 'error'; st.msg = msg; st.busy = false; close(); render();
  }
  function fail(msg) { st.msg = msg; st.busy = false; render(); }

  function selectedDeck() {
    var d = TCUI.store.get(TCUI.store.selectedId());
    return JSON.parse(JSON.stringify(d.cards));
  }

  // ---------- handshake and messages ----------
  function onMessage(m) {
    if (m.t === 'hello') {
      peer = m;
      if (role === 'host') hostBegin();
    } else if (m.t === 'start') {
      if (role !== 'guest') return;
      var bad = TC.validateDeck(m.decks[0]).ok && TC.validateDeck(m.decks[1]).ok ? '' : 'One of the decks is not legal in this version of the game.';
      if (bad) { send({ t: 'error', msg: bad }); lost(bad); return; }
      begin(m, 1);
    } else if (m.t === 'rematch') {
      peerRematch = true;
      if (role === 'host' && myRematch) hostBegin(); else overNote();
    } else if (m.t === 'error') {
      lost(m.msg || 'Your friend ended the connection.');
    } else {
      TCUI.duel.netMessage(m);
    }
  }
  function hostBegin() {
    if (!peer) return;
    var problem = '';
    if (peer.v !== TC.contentHash()) problem = 'You and your friend are running different versions of the game. Both of you should reload the page.';
    else if (!peer.deck || !TC.validateDeck(peer.deck).ok) problem = 'Your friend\'s deck is not legal. They need to pick a valid deck.';
    if (problem) { send({ t: 'error', msg: problem }); lost(problem); return; }
    var seed = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
    var first = Math.random() < 0.5 ? 0 : 1;
    var msg = { t: 'start', seed: seed, first: first, decks: [selectedDeck(), peer.deck], names: [myName(), String(peer.name || 'Friend').slice(0, 16)] };
    send(msg);
    begin(msg, 0);
  }
  function begin(msg, me) {
    started = true; myRematch = false; peerRematch = false;
    TCUI.go('game');
    TCUI.duel.startOnline({ me: me, seed: msg.seed, first: msg.first, decks: msg.decks, names: msg.names, net: { send: send } });
  }
  function overNote() {
    var sub = $('#over-sub');
    if (!sub || $('#over').hidden) return;
    var n = TCUI.rematchNote();
    if (n) sub.textContent = n;
  }
  TCUI.rematchNote = function () {
    if (myRematch && !peerRematch) return 'Waiting for your friend to accept the rematch...';
    if (peerRematch && !myRematch) return 'Your friend wants a rematch. Tap Rematch to accept.';
    return '';
  };

  // ---------- screen ----------
  function deckLine() {
    var d = TCUI.store.get(TCUI.store.selectedId());
    return '<p class="note">You will play your selected deck: <b>' + esc(d.name) + '</b> (' + TC.deckCount(d.cards) + ' cards). Change it from the main menu.</p>';
  }
  function codeBox(id, value, label) {
    return '<div class="lbl">' + label + '</div>' +
      '<textarea id="' + id + '" class="field code" readonly rows="4" aria-label="' + esc(label) + '">' + esc(value) + '</textarea>' +
      '<div class="row"><button class="sbtn flex" data-o="copy" data-t="' + id + '">Copy code</button>' +
      (navigator.share ? '<button class="sbtn flex" data-o="share" data-t="' + id + '">Share...</button>' : '') + '</div>';
  }
  function msgLine() { return st.msg ? '<p class="badtxt" role="alert">' + esc(st.msg) + '</p>' : ''; }

  function render() {
    var h = '<div class="row sp"><h2 class="title">Play a friend</h2><button class="sbtn" data-o="back">Back</button></div>';
    if (st.step === 'home' || st.step === 'error') {
      h += '<p class="sub">Two players, one connection, no sign-up. You trade two short codes in any chat app (text, Discord, anything).</p>' +
        '<div class="lbl">Your name</div><input id="oname" class="field" maxlength="16" placeholder="Friend" value="' + esc(getName()) + '" aria-label="Your name">' +
        deckLine() + msgLine() +
        '<button class="start" data-o="host">Host a game</button>' +
        '<button class="sbtn" data-o="join">Join a friend\'s game</button>';
    } else if (st.step === 'hosting') {
      h += '<ol class="steps"><li><b>Send this invite code to your friend.</b> They open Otaku Showdown, choose Play a friend, then Join.</li>' +
        '<li><b>Paste the reply code they send back</b> below and press Connect.</li></ol>' +
        (st.code ? codeBox('ocode', st.code, 'Invite code (send this)') : '<p class="note">Making your invite code...</p>') +
        '<div class="lbl">Reply code from your friend</div>' +
        '<textarea id="oreply" class="field code" rows="4" placeholder="Paste the reply code here" aria-label="Reply code"></textarea>' + msgLine() +
        '<button class="start" data-o="connect"' + (st.busy || !st.code ? ' disabled' : '') + '>' + (st.busy ? 'Connecting...' : 'Connect') + '</button>' +
        '<button class="sbtn" data-o="cancel">Cancel</button>';
    } else if (st.step === 'joining') {
      h += '<ol class="steps"><li><b>Paste the invite code</b> your friend sent you and press Make reply.</li>' +
        '<li><b>Send them the reply code.</b> The duel starts on its own once they paste it.</li></ol>' +
        (st.reply
          ? codeBox('oreplycode', st.reply, 'Reply code (send this back)') + '<p class="note" role="status">Waiting for the host to connect...</p>'
          : '<div class="lbl">Invite code from your friend</div><textarea id="oinvite" class="field code" rows="4" placeholder="Paste the invite code here" aria-label="Invite code"></textarea>' +
            msgLine() + '<button class="start" data-o="makereply"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Working...' : 'Make reply') + '</button>') +
        '<button class="sbtn" data-o="cancel">Cancel</button>';
    }
    el().innerHTML = h;
  }

  TCUI.online = {
    show: function () { if (!started) { st = { step: 'home', code: '', reply: '', msg: '', busy: false }; } render(); },
    leave: function () { started = false; peer = null; role = null; close(); st.step = 'home'; },
    rematch: function () {
      if (!started) return;
      myRematch = true;
      send({ t: 'rematch' });
      if (role === 'host' && peerRematch) hostBegin(); else overNote();
    },
    _state: function () { return { role: role, started: started }; }
  };

  async function onHost() {
    started = false; peer = null; role = 'host';
    st = { step: 'hosting', code: '', reply: '', msg: '', busy: false };
    render();
    try {
      close();
      pc = newPC();
      wire(pc.createDataChannel('duel', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      st.code = await encodeCode('o', { sdp: pc.localDescription.sdp });
    } catch (e) { st.step = 'error'; st.msg = e.message || 'Could not start a game here.'; close(); }
    render();
  }
  async function onConnect() {
    var text = ($('#oreply') || {}).value;
    st.busy = true; st.msg = ''; render();
    try {
      var o = await decodeCode(text, 'a');
      await pc.setRemoteDescription({ type: 'answer', sdp: o.sdp });
      st.msg = '';
      setTimeout(function () { if (!started && st.step === 'hosting') { st.busy = false; st.msg = 'Still connecting. If this takes more than a few seconds, the connection may be blocked. Try again.'; render(); } }, 15000);
    } catch (e) { st.busy = false; st.msg = e.message || 'Could not use that code.'; }
    render();
  }
  async function onMakeReply() {
    var text = ($('#oinvite') || {}).value;
    st.busy = true; st.msg = ''; render();
    try {
      var o = await decodeCode(text, 'o');
      close();
      pc = newPC();
      pc.ondatachannel = function (e) { wire(e.channel); };
      await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      st.reply = await encodeCode('a', { sdp: pc.localDescription.sdp });
    } catch (e) { st.msg = e.message || 'Could not use that code.'; }
    st.busy = false;
    render();
  }

  async function copyFrom(id, btn) {
    var box = document.getElementById(id);
    if (!box) return;
    box.focus(); box.select();
    var ok = false;
    try { await navigator.clipboard.writeText(box.value); ok = true; } catch (e) { try { ok = document.execCommand('copy'); } catch (x) { ok = false; } }
    btn.textContent = ok ? 'Copied' : 'Select and copy it';
    setTimeout(function () { if (btn.isConnected) btn.textContent = 'Copy code'; }, 2000);
  }
  async function shareFrom(id) {
    var box = document.getElementById(id);
    try { await navigator.share({ title: 'Otaku Showdown', text: box.value }); } catch (e) { /* cancelled or blocked: the Copy button still works */ }
  }

  document.addEventListener('input', function (e) { if (e.target.id === 'oname') setName(e.target.value); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-o]');
    if (!t || !el() || el().hidden) return;
    var a = t.getAttribute('data-o');
    if (a === 'back') TCUI.go('menu');
    else if (a === 'host') onHost();
    else if (a === 'join') { role = 'guest'; peer = null; st = { step: 'joining', code: '', reply: '', msg: '', busy: false }; render(); }
    else if (a === 'connect') onConnect();
    else if (a === 'makereply') onMakeReply();
    else if (a === 'cancel') { close(); role = null; st = { step: 'home', code: '', reply: '', msg: '', busy: false }; render(); }
    else if (a === 'copy') copyFrom(t.getAttribute('data-t'), t);
    else if (a === 'share') shareFrom(t.getAttribute('data-t'));
  });
})();
