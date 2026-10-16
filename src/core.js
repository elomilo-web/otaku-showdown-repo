var TC = (typeof TC === 'undefined') ? {} : TC;

/*
  Otaku Showdown - core registry.
  Everything that can grow (cards, sets, keywords, rules, effect ops, conditions) is registered here, so an
  expansion is a single file in src/sets/ that calls TC.registerSet(...) and never touches the engine.
  See docs/ADDING_CARDS.md.
*/
(function () {
  TC.CARDS = {};          // id -> card (filled by registerSet)
  TC.SETS = {};           // set id -> { id, name, cards: [ids] }
  TC.SET_ORDER = [];
  TC.PRESETS = [];
  TC.RULE_DEFS = {};      // rule name -> { default, label, describe(passive) }
  TC.KW = {};             // keyword id -> { label, text, passives }
  TC.OPS = {};            // effect op name -> { run(g, link, args), text(args) }
  TC.CONDS = {};          // condition name -> { check(g, link, value) }
  TC.DECK_MIN = 40;
  TC.DECK_MAX = 60;

  TC.registerRule = function (name, def) { TC.RULE_DEFS[name] = def; };
  TC.registerKeyword = function (id, def) { TC.KW[id] = def; };
  TC.registerOp = function (name, def) { TC.OPS[name] = def; };
  TC.registerCond = function (name, def) { TC.CONDS[name] = def; };

  var SPELL_SUBS = ['normal', 'quick', 'equip', 'continuous', 'field'];
  var TRAP_SUBS = ['normal', 'continuous', 'counter'];
  var TRIGGERS = ['attack', 'summon', 'activate', 'any'];
  var EFFECT_ON = ['debut', 'flip', 'activate', 'standby'];
  var SCOPES = ['self', 'equipped', 'ownMonsters', 'foeMonsters', 'allMonsters', 'player', 'foePlayer'];

  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  // Returns a list of problems with a card definition (empty list = fine).
  TC.validateCard = function (id, c) {
    var e = [];
    function bad(m) { e.push(id + ': ' + m); }
    if (!c || typeof c !== 'object') return [id + ': not an object'];
    if (!c.name) bad('missing name');
    if (!c.glyph) bad('missing glyph (one kanji used as the art)');
    if (typeof c.hue !== 'number') bad('missing hue (0-360)');
    if (c.limit !== undefined && !(isInt(c.limit) && c.limit >= 1)) bad('limit must be a whole number >= 1');
    if (['monster', 'spell', 'trap'].indexOf(c.type) < 0) { bad('type must be monster, spell or trap'); return e; }
    if (c.type === 'monster') {
      if (!(isInt(c.lv) && c.lv >= 1 && c.lv <= 12)) bad('lv must be 1-12');
      if (!(isInt(c.atk) && c.atk >= 0)) bad('atk must be a whole number');
      if (!(isInt(c.def) && c.def >= 0)) bad('def must be a whole number');
    } else if (c.type === 'spell') {
      if (SPELL_SUBS.indexOf(c.sub) < 0) bad('spell sub must be one of ' + SPELL_SUBS.join('/'));
    } else {
      if (c.sub !== undefined && TRAP_SUBS.indexOf(c.sub) < 0) bad('trap sub must be one of ' + TRAP_SUBS.join('/'));
      if (TRIGGERS.indexOf(c.trigger) < 0) bad('trap trigger must be one of ' + TRIGGERS.join('/'));
    }
    if (c.target !== undefined && ['own', 'foe'].indexOf(c.target) < 0) bad('target must be own or foe');
    (c.kw || []).forEach(function (k) { if (!TC.KW[k]) bad('unknown keyword ' + k); });
    (c.passives || []).forEach(function (p) {
      if (!TC.RULE_DEFS[p.rule]) bad('passive uses unknown rule ' + p.rule);
      if (p.value === undefined) bad('passive ' + p.rule + ' needs a value');
      if (p.scope && SCOPES.indexOf(p.scope) < 0) bad('passive scope ' + p.scope);
      Object.keys(p.when || {}).forEach(function (k) { if (!TC.CONDS[k]) bad('unknown condition ' + k); });
    });
    var hasActivate = false;
    (c.effects || []).forEach(function (f) {
      if (EFFECT_ON.indexOf(f.on) < 0) bad('effect.on must be one of ' + EFFECT_ON.join('/'));
      if (f.on === 'activate') hasActivate = true;
      if ((f.on === 'debut' || f.on === 'flip') && c.type !== 'monster') bad(f.on + ' effects belong on monsters');
      if (!Array.isArray(f.ops) || !f.ops.length) bad('effect needs ops');
      (f.ops || []).forEach(function (o) {
        if (!TC.OPS[o.op]) bad('unknown op ' + o.op);
      });
      Object.keys(f.when || {}).forEach(function (k) { if (!TC.CONDS[k]) bad('unknown condition ' + k); });
    });
    var needsActivate = (c.type === 'spell' && (c.sub === 'normal' || c.sub === 'quick')) || c.type === 'trap';
    if (needsActivate && !hasActivate) bad('needs an effect with on: "activate"');
    return e;
  };

  // Plain-language text from the data, used when a card has no hand-written text.
  TC.describe = function (c) {
    var parts = [];
    (c.effects || []).forEach(function (f) {
      var frag = f.ops.map(function (o) { return TC.OPS[o.op].text(o); }).join(' and ');
      var pre = f.on === 'debut' ? 'Debut: ' : f.on === 'flip' ? 'Flip: ' : f.on === 'standby' ? 'During your Standby Phase, ' : '';
      if (f.on === 'activate' && c.target === 'own') pre = 'Target 1 face-up monster you control: ';
      if (f.on === 'activate' && c.target === 'foe') pre = 'Target 1 monster your opponent controls: ';
      var s = pre + frag;
      parts.push(s.charAt(0).toUpperCase() + s.slice(1) + '.');
    });
    (c.passives || []).forEach(function (p) {
      var d = TC.RULE_DEFS[p.rule];
      if (d && d.describe) parts.push(d.describe(p));
    });
    return parts.join(' ');
  };

  // Keywords are shorthand for passives; flatten both into one list per card.
  function flatten(c) {
    var out = (c.passives || []).slice();
    (c.kw || []).forEach(function (k) { (TC.KW[k].passives || []).forEach(function (p) { out.push(p); }); });
    return out;
  }

  TC.registerSet = function (set) {
    var errors = [], ids = Object.keys(set.cards || {});
    if (!set.id || !set.name) errors.push('set needs id and name');
    if (TC.SETS[set.id]) errors.push('set ' + set.id + ' is already registered');
    ids.forEach(function (id) {
      if (TC.CARDS[id]) errors.push(id + ': card id already exists');
      TC.validateCard(id, set.cards[id]).forEach(function (m) { errors.push(m); });
    });
    if (errors.length) throw new Error('Set "' + set.id + '" is invalid:\n  ' + errors.join('\n  '));
    ids.forEach(function (id) {
      var c = set.cards[id];
      c.set = set.id;
      c.allPassives = flatten(c);
      if (typeof c.text !== 'string') c.text = TC.describe(c);
      TC.CARDS[id] = c;
    });
    TC.SETS[set.id] = { id: set.id, name: set.name, blurb: set.blurb || '', cards: ids };
    TC.SET_ORDER.push(set.id);
    (set.presets || []).forEach(function (p) {
      var v = TC.validateDeck(p.cards);
      if (!v.ok) throw new Error('Preset "' + p.name + '" in set ' + set.id + ' is not a legal deck: ' + v.errors.join(' '));
      p.preset = true;
      TC.PRESETS.push(p);
    });
  };

  // ---------- formats: the ban / limit list ----------
  // Default is 3 copies of any card. A card can set its own `limit` in its data, and a format (a ban/limit
  // list) overrides both: limits: { cardId: n } where 0 means banned. Add one with TC.registerFormat.
  TC.FORMATS = {};
  TC.format = 'standard';
  TC.registerFormat = function (f) {
    if (!f || !f.id || !f.name) throw new Error('format needs id and name');
    Object.keys(f.limits || {}).forEach(function (id) {
      var n = f.limits[id];
      if (!(typeof n === 'number' && n >= 0 && Math.floor(n) === n)) throw new Error('format ' + f.id + ': limit for ' + id + ' must be a whole number >= 0');
    });
    TC.FORMATS[f.id] = f;
  };
  TC.registerFormat({ id: 'standard', name: 'Standard', limits: {} });   // no restrictions yet: 3 of anything

  TC.limitOf = function (id) {
    var c = TC.CARDS[id];
    if (!c) return 0;
    var f = TC.FORMATS[TC.format];
    if (f && f.limits && typeof f.limits[id] === 'number') return f.limits[id];
    return (typeof c.limit === 'number') ? c.limit : 3;
  };

  // Fingerprint of everything that must match between two players (cards, rules data, format).
  TC.contentHash = function () {
    var f = TC.FORMATS[TC.format] || {};
    var parts = Object.keys(TC.CARDS).sort().map(function (id) {
      var c = TC.CARDS[id];
      return id + ':' + [c.type, c.lv, c.atk, c.def, c.sub, c.trigger, c.target, JSON.stringify(c.effects || ''), JSON.stringify(c.passives || ''), (c.kw || []).join(',')].join('/');
    });
    parts.push('fmt:' + TC.format + JSON.stringify(f.limits || {}));
    var h = 2166136261, s = parts.join('|');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  };

  TC.requiredTributes = function (lv) { return lv >= 7 ? 2 : (lv >= 5 ? 1 : 0); };

  // Display order for the deck editor: monsters by level, then spells, then traps.
  TC.cardOrder = function () {
    var ids = Object.keys(TC.CARDS);
    var rank = { monster: 0, spell: 1, trap: 2 };
    return ids.sort(function (a, b) {
      var ca = TC.CARDS[a], cb = TC.CARDS[b];
      if (rank[ca.type] !== rank[cb.type]) return rank[ca.type] - rank[cb.type];
      if (ca.type === 'monster' && ca.lv !== cb.lv) return ca.lv - cb.lv;
      return ca.name < cb.name ? -1 : 1;
    });
  };

  TC.deckCount = function (cards) {
    var n = 0;
    for (var k in cards) n += cards[k] || 0;
    return n;
  };

  // cards: { cardId: count }
  TC.validateDeck = function (cards) {
    var errors = [], n = 0;
    for (var id in cards) {
      var c = cards[id];
      if (!c) continue;
      if (!TC.CARDS[id]) { errors.push('Unknown card ' + id + '.'); continue; }
      if (c > TC.limitOf(id)) errors.push(TC.CARDS[id].name + (TC.limitOf(id) === 0 ? ' is banned.' : ': limit is ' + TC.limitOf(id) + '.'));
      n += c;
    }
    if (n < TC.DECK_MIN) errors.push('Add ' + (TC.DECK_MIN - n) + ' more card' + (TC.DECK_MIN - n === 1 ? '' : 's') + ' (minimum ' + TC.DECK_MIN + ').');
    if (n > TC.DECK_MAX) errors.push('Remove ' + (n - TC.DECK_MAX) + ' card' + (n - TC.DECK_MAX === 1 ? '' : 's') + ' (maximum ' + TC.DECK_MAX + ').');
    return { ok: errors.length === 0, count: n, errors: errors };
  };

  TC.expandDeck = function (cards) {
    var out = [];
    for (var id in cards) for (var i = 0; i < (cards[id] || 0); i++) out.push(id);
    return out;
  };

  TC.presetById = function (id) {
    for (var i = 0; i < TC.PRESETS.length; i++) if (TC.PRESETS[i].id === id) return TC.PRESETS[i];
    return null;
  };
})();
