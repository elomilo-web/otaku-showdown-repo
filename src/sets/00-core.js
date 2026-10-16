/*
  Core Set. Cards are plain data: no code. See docs/ADDING_CARDS.md for every field.

  Monster effects:  effects: [{ on: 'debut' | 'flip', ops: [...] }]
  Spells / Traps:   effects: [{ on: 'activate', when?: {...}, ops: [...] }]
  Rule changes:     passives: [{ rule, value, scope }]   (the golden rule: cards bend the base rules)
*/
TC.registerSet({
  id: 'core',
  name: 'Core Set',
  blurb: 'The first wave of anime tropes.',
  cards: {
    // ---------- Monsters ----------
    mascot:      { name: 'Mascot Sidekick',    type: 'monster', lv: 1, atk: 300,  def: 200,  glyph: '妖', hue: 45,  effects: [{ on: 'debut', ops: [{ op: 'gain', n: 500 }] }], text: 'Debut: gain 500 Life Points.' },
    transfer:    { name: 'Transfer Student',   type: 'monster', lv: 2, atk: 800,  def: 500,  glyph: '転', hue: 205, effects: [{ on: 'flip', ops: [{ op: 'draw', n: 1 }] }], text: 'Flip: draw 1 card.' },
    maid:        { name: 'Cat-Eared Maid',     type: 'monster', lv: 2, atk: 600,  def: 1500, glyph: '猫', hue: 335, effects: [{ on: 'flip', ops: [{ op: 'gain', n: 1000 }] }], text: 'Flip: gain 1000 Life Points.' },
    tsundere:    { name: 'Tsundere',           type: 'monster', lv: 3, atk: 1400, def: 600,  glyph: '怒', hue: 10,  effects: [{ on: 'flip', ops: [{ op: 'burn', n: 500 }] }], text: 'Flip: inflict 500 damage to your opponent.' },
    friend:      { name: 'Childhood Friend',   type: 'monster', lv: 3, atk: 1000, def: 1600, glyph: '友', hue: 150, text: '' },
    ninja:       { name: 'Ninja',              type: 'monster', lv: 3, atk: 1000, def: 500,  glyph: '忍', hue: 250, kw: ['direct'], text: '' },
    henchman:    { name: 'Henchman',           type: 'monster', lv: 3, atk: 1100, def: 700,  glyph: '卒', hue: 300, effects: [{ on: 'debut', ops: [{ op: 'burn', n: 300 }] }], text: 'Debut: inflict 300 damage to your opponent.' },
    shrine:      { name: 'Shrine Maiden',      type: 'monster', lv: 3, atk: 700,  def: 1500, glyph: '巫', hue: 0,   effects: [{ on: 'flip', ops: [{ op: 'destroy', scope: 'foeST', pick: 'random' }] }], text: 'Flip: destroy 1 random Spell/Trap your opponent controls.' },
    doll:        { name: 'Haunted Doll',       type: 'monster', lv: 3, atk: 900,  def: 1400, glyph: '人', hue: 285, effects: [{ on: 'flip', ops: [{ op: 'burn', n: 800 }] }], text: 'Flip: inflict 800 damage to your opponent.' },
    classrep:    { name: 'Class Rep',          type: 'monster', lv: 3, atk: 800,  def: 1800, glyph: '委', hue: 165, text: '' },
    loner:       { name: 'Edgy Loner',         type: 'monster', lv: 4, atk: 1800, def: 800,  glyph: '孤', hue: 235, kw: ['noblock'], text: '' },
    rival:       { name: 'Rival',              type: 'monster', lv: 4, atk: 1800, def: 1500, glyph: '敵', hue: 0,   text: '' },
    strategist:  { name: 'Cunning Strategist', type: 'monster', lv: 4, atk: 1400, def: 1700, glyph: '策', hue: 190, effects: [{ on: 'flip', ops: [{ op: 'draw', n: 1 }] }], text: 'Flip: draw 1 card.' },
    swordmaster: { name: 'Swordmaster',        type: 'monster', lv: 4, atk: 1900, def: 1100, glyph: '剣', hue: 215, kw: ['pierce'], text: '' },
    idol:        { name: 'Idol Singer',        type: 'monster', lv: 4, atk: 1200, def: 1800, glyph: '歌', hue: 320, effects: [{ on: 'debut', ops: [{ op: 'gain', n: 1000 }] }], text: 'Debut: gain 1000 Life Points.' },
    delinquent:  { name: 'Delinquent Boy',     type: 'monster', lv: 4, atk: 1600, def: 1000, glyph: '不', hue: 25,  effects: [{ on: 'debut', ops: [{ op: 'burn', n: 500 }] }], text: 'Debut: inflict 500 damage to your opponent.' },
    hacker:      { name: 'Genius Hacker',      type: 'monster', lv: 4, atk: 1500, def: 1300, glyph: '電', hue: 180, effects: [{ on: 'debut', ops: [{ op: 'destroy', scope: 'foeST', pick: 'random' }] }], text: 'Debut: destroy 1 random Spell/Trap your opponent controls.' },
    bodyguard:   { name: 'Stoic Bodyguard',    type: 'monster', lv: 4, atk: 1000, def: 2000, glyph: '守', hue: 130, text: '' },
    herohot:     { name: 'Hot-Blooded Hero',   type: 'monster', lv: 5, atk: 2200, def: 1600, glyph: '熱', hue: 20,  text: '' },
    president:   { name: 'Council President',  type: 'monster', lv: 5, atk: 1600, def: 2400, glyph: '会', hue: 175, text: '' },
    magical:     { name: 'Magical Girl',       type: 'monster', lv: 5, atk: 2000, def: 1700, glyph: '魔', hue: 330, effects: [{ on: 'debut', ops: [{ op: 'destroy', scope: 'foeMonsters', pick: 'random' }] }], text: 'Debut: destroy 1 random monster your opponent controls.' },
    champion:    { name: 'Tournament Champion',type: 'monster', lv: 6, atk: 2400, def: 2000, glyph: '覇', hue: 55,  kw: ['pierce'], text: '' },
    mentor:      { name: 'Mentor Figure',      type: 'monster', lv: 6, atk: 1800, def: 2300, glyph: '師', hue: 30,  effects: [{ on: 'debut', ops: [{ op: 'buff', who: 'otherOwnMonsters', atk: 300, def: 300, dur: 'perm' }] }], text: 'Debut: your other monsters gain 300 ATK and DEF permanently.' },
    chosen:      { name: 'The Chosen One',     type: 'monster', lv: 6, atk: 2500, def: 2000, glyph: '選', hue: 50,  effects: [{ on: 'debut', ops: [{ op: 'draw', n: 1 }] }], text: 'Debut: draw 1 card.' },
    isekai:      { name: 'Isekai Protagonist', type: 'monster', lv: 7, atk: 2800, def: 2200, glyph: '異', hue: 120, effects: [{ on: 'debut', ops: [{ op: 'draw', n: 2 }] }], text: 'Debut: draw 2 cards.' },
    mecha:       { name: 'Mecha Pilot',        type: 'monster', lv: 7, atk: 3000, def: 2500, glyph: '機', hue: 200, text: '' },
    darklord:    { name: 'Dark Lord',          type: 'monster', lv: 8, atk: 3200, def: 3000, glyph: '闇', hue: 275, effects: [{ on: 'debut', ops: [{ op: 'destroy', scope: 'foeMonsters', pick: 'all' }] }], text: 'Debut: destroy all monsters your opponent controls.' },
    robot:       { name: 'Giant Robot',        type: 'monster', lv: 8, atk: 3500, def: 2800, glyph: '巨', hue: 210, text: '' },

    // ---------- Spells ----------
    flashback:   { name: 'Flashback Episode',   type: 'spell', sub: 'normal', glyph: '回', hue: 265, effects: [{ on: 'activate', ops: [{ op: 'draw', n: 2 }] }], text: 'Draw 2 cards.' },
    springs:     { name: 'Hot Springs Episode', type: 'spell', sub: 'normal', glyph: '湯', hue: 265, effects: [{ on: 'activate', ops: [{ op: 'gain', n: 2000 }] }], text: 'Gain 2000 Life Points.' },
    powerup:     { name: 'Sudden Power-Up',     type: 'spell', sub: 'quick', target: 'own', glyph: '力', hue: 265, effects: [{ on: 'activate', ops: [{ op: 'buff', who: 'target', atk: 800, dur: 'turn' }] }], text: 'Quick-Play. Target 1 face-up monster you control: it gains 800 ATK until the end of this turn.' },
    trainarc:    { name: 'Training Arc',        type: 'spell', sub: 'normal', target: 'own', glyph: '修', hue: 265, effects: [{ on: 'activate', ops: [{ op: 'buff', who: 'target', atk: 500, def: 500, dur: 'perm' }] }], text: 'Target 1 face-up monster you control: it permanently gains 500 ATK and DEF.' },
    sword:       { name: 'Legendary Sword',     type: 'spell', sub: 'equip', target: 'own', glyph: '刀', hue: 265, passives: [{ rule: 'atk', value: 700, scope: 'equipped' }], text: 'Equip to a face-up monster you control. It gains 700 ATK.' },
    armor:       { name: 'Plot Armor',          type: 'spell', sub: 'equip', target: 'own', glyph: '盾', hue: 265, passives: [{ rule: 'def', value: 800, scope: 'equipped' }], text: 'Equip to a face-up monster you control. It gains 800 DEF.' },
    friendship:  { name: 'Power of Friendship', type: 'spell', sub: 'normal', glyph: '絆', hue: 265, effects: [{ on: 'activate', ops: [{ op: 'buff', who: 'ownMonsters', faceUp: true, atk: 300, def: 300, dur: 'turn' }] }], text: 'All face-up monsters you control gain 300 ATK and DEF until the end of this turn.' },
    truck:       { name: 'Isekai Truck',        type: 'spell', sub: 'normal', target: 'foe', glyph: '車', hue: 265, effects: [{ on: 'activate', ops: [{ op: 'destroy', scope: 'target' }] }], text: 'Target 1 monster your opponent controls (even face-down): destroy it.' },
    beam:        { name: 'Beam Spam',           type: 'spell', sub: 'normal', glyph: '光', hue: 265, effects: [{ on: 'activate', ops: [{ op: 'destroy', scope: 'foeMonsters', filter: 'atkPos' }] }], text: 'Destroy all Attack Position monsters your opponent controls.' },
    ultimate:    { name: 'Ultimate Technique',  type: 'spell', sub: 'normal', glyph: '極', hue: 265, effects: [{ on: 'activate', ops: [{ op: 'burn', n: 1500 }] }], text: 'Inflict 1500 damage to your opponent.' },
    reveal:      { name: 'Dramatic Reveal',     type: 'spell', sub: 'normal', glyph: '開', hue: 265, effects: [{ on: 'activate', ops: [{ op: 'flipAll' }] }], text: 'Flip all face-down monsters on the field face-up in Defense Position. Flip effects activate.' },
    camp:        { name: 'Training Camp',       type: 'spell', sub: 'field', glyph: '合', hue: 265, passives: [{ rule: 'atk', value: 300, scope: 'ownMonsters' }, { rule: 'def', value: 300, scope: 'ownMonsters' }], text: 'Field Spell. Monsters you control gain 300 ATK and DEF.' },
    cheer:       { name: 'Cheering Section',    type: 'spell', sub: 'continuous', glyph: '援', hue: 265, effects: [{ on: 'standby', ops: [{ op: 'gain', n: 300 }] }], text: 'Continuous Spell. During your Standby Phase, gain 300 Life Points.' },

    // ---------- Traps ----------
    trapdoor:    { name: 'Hidden Trapdoor',     type: 'trap', trigger: 'summon', glyph: '穴', hue: 340, effects: [{ on: 'activate', when: { summonedAtkGte: 1000 }, ops: [{ op: 'destroy', scope: 'summoned' }] }], text: 'When your opponent Summons a monster with 1000 or more ATK: destroy it.' },
    interrupt:   { name: 'Sudden Interruption', type: 'trap', trigger: 'attack', glyph: '止', hue: 340, effects: [{ on: 'activate', ops: [{ op: 'negate', what: 'attack' }] }], text: 'When an opponent monster declares an attack: negate the attack.' },
    mirror:      { name: 'Mirror Reflection',   type: 'trap', trigger: 'attack', glyph: '鏡', hue: 340, effects: [{ on: 'activate', ops: [{ op: 'destroy', scope: 'foeMonsters', filter: 'atkPos' }] }], text: 'When an opponent monster declares an attack: destroy all Attack Position monsters your opponent controls.' },
    ambush:      { name: 'Hidden Ambush',       type: 'trap', trigger: 'attack', glyph: '伏', hue: 340, effects: [{ on: 'activate', ops: [{ op: 'destroy', scope: 'attacker' }] }], text: 'When an opponent monster declares an attack: destroy the attacking monster.' },
    plea:        { name: 'Heartfelt Plea',      type: 'trap', trigger: 'attack', glyph: '願', hue: 340, effects: [{ on: 'activate', ops: [{ op: 'negate', what: 'attack' }, { op: 'gain', n: 1000 }] }], text: 'When an opponent monster declares an attack: negate the attack and gain 1000 Life Points.' },
    twist:       { name: 'Plot Twist',          type: 'trap', trigger: 'attack', glyph: '逆', hue: 340, effects: [{ on: 'activate', ops: [{ op: 'negate', what: 'attack' }, { op: 'setPos', pos: 'def' }] }], text: 'When an opponent monster declares an attack: negate the attack and change the attacker to Defense Position.' }
  },

  presets: [
    {
      id: 'preset:rush', name: 'Shonen Rush', glyph: '熱', hue: 15,
      blurb: 'Fast monsters, direct attackers and burn. End it before they set up.',
      keys: ['ninja', 'swordmaster', 'ultimate'],
      cards: { tsundere: 3, ninja: 3, henchman: 3, delinquent: 3, loner: 3, rival: 3, swordmaster: 3, herohot: 3, champion: 2,
               sword: 3, powerup: 3, trainarc: 2, ultimate: 2, interrupt: 2, twist: 2 }
    },
    {
      id: 'preset:sol', name: 'Slice of Life', glyph: '友', hue: 150,
      blurb: 'Set monsters face-down, flip them for value and heal your way to victory.',
      keys: ['maid', 'strategist', 'camp'],
      cards: { maid: 2, transfer: 3, doll: 3, tsundere: 3, strategist: 3, rival: 3, loner: 2, swordmaster: 3, herohot: 3, president: 2,
               camp: 2, cheer: 1, powerup: 3, trainarc: 2, interrupt: 3, twist: 3, mirror: 2 }
    },
    {
      id: 'preset:dark', name: 'Dark Isekai', glyph: '闇', hue: 275,
      blurb: 'Tribute for huge monsters, remove threats, and trap anything that moves.',
      keys: ['darklord', 'truck', 'trapdoor'],
      cards: { mascot: 3, transfer: 3, hacker: 2, strategist: 2, rival: 3, chosen: 2, mentor: 1, isekai: 1, mecha: 1, darklord: 1,
               delinquent: 3, henchman: 3, swordmaster: 2, flashback: 1, truck: 1, reveal: 2, trapdoor: 2, mirror: 2, ambush: 2,
               interrupt: 2, ultimate: 2, springs: 2 }
    }
  ]
});
