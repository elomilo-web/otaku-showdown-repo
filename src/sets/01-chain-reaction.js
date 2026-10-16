/*
  Chain Reaction (mini expansion). Shows the modular system: this whole file is the expansion.
  Drop a file like this into src/sets/ and the build picks it up. No engine changes.
  Every card here bends a base rule (the golden rule): extra attacks, bigger hand, extra Summons,
  and a Counter Trap that answers a Spell/Trap on the chain.
*/
TC.registerSet({
  id: 'chain',
  name: 'Chain Reaction',
  blurb: 'Rule benders and Counter Traps for chain play.',
  cards: {
    dualblade: { name: 'Dual-Wield Swordsman', type: 'monster', lv: 4, atk: 1500, def: 1000, glyph: '双', hue: 205, passives: [{ rule: 'attacksPerTurn', value: 1, scope: 'self' }] },
    backpack: { name: 'Bottomless Backpack', type: 'spell', sub: 'continuous', glyph: '袋', hue: 265, passives: [{ rule: 'handLimit', value: 2, scope: 'player' }] },
    pacing: { name: 'Shonen Pacing', type: 'spell', sub: 'continuous', glyph: '速', hue: 265, passives: [{ rule: 'summonsPerTurn', value: 1, scope: 'player' }] },
    denied: { name: 'Nani?! Denied', type: 'trap', sub: 'counter', trigger: 'activate', glyph: '否', hue: 340, effects: [{ on: 'activate', when: { belowIsSpellTrap: true }, ops: [{ op: 'negate', what: 'link' }] }],
      text: 'Counter Trap. When your opponent activates a Spell or Trap: negate the activation and destroy it.' }
  }
});
