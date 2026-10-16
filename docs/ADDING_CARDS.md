# Adding cards, sets and mechanics

Cards are data. An expansion is **one file** in `src/sets/` (files load in name order: `02-my-set.js`).
The build (`node build.js`) and the tests pick it up automatically. No engine changes.

```js
TC.registerSet({
  id: 'myset', name: 'My Set', blurb: 'One line.',
  cards: {
    cardid: { name: 'Card Name', type: 'monster', lv: 4, atk: 1800, def: 1200, glyph: '剣', hue: 210 }
  },
  presets: [ /* optional ready-made decks */ ]
});
```

A bad definition throws a readable error at load time (unknown op, missing field, duplicate id), and
`node tests/engine.test.js` validates every card.

## Fields
| Field | Applies to | Meaning |
|---|---|---|
| `name`, `glyph` (one kanji, used as art), `hue` (0-360) | all | required |
| `type` | all | `monster`, `spell`, `trap` |
| `limit` | all | optional per-card copy limit. Leave it out: every card is 3 per deck. Only add it when the design says so |
| `lv`, `atk`, `def` | monster | Level 1-12 (5-6 need 1 Tribute, 7+ need 2) |
| `sub` | spell | `normal`, `quick`, `equip`, `continuous`, `field` |
| `sub` | trap | omit for a normal Trap, or `counter` (Spell Speed 3) |
| `trigger` | trap | `attack`, `summon`, `activate` (a Spell/Trap/effect is on the chain), `any` |
| `target` | spell | `own` (face-up monster you control) or `foe` (monster they control) |
| `kw` | monster | keyword shorthand: `pierce`, `direct`, `noblock` |
| `effects` | all | see below |
| `passives` | all | rule changes while face-up, see below |
| `text` | all | optional; if omitted it is written from the data |

## Effects (things that happen)
```js
effects: [{ on: 'debut',    ops: [...] }]   // monster face-up Normal/Tribute Summoned
effects: [{ on: 'flip',     ops: [...] }]   // monster turned face-up
effects: [{ on: 'activate', when: {...}, ops: [...] }]   // Spell or Trap activation
effects: [{ on: 'standby',  ops: [...] }]   // each of your Standby Phases (face-up)
```
`ops` run in order. Built-in ops (`src/builtins.js`):

| op | args |
|---|---|
| `gain` / `burn` | `n` Life Points to you / damage to opponent |
| `draw` | `n` |
| `destroy` | `scope`: `foeMonsters`, `ownMonsters`, `foeST`, `target`, `attacker`, `summoned`; `pick`: `all` or `random`; `filter`: `atkPos` |
| `buff` | `who`: `target`, `self`, `ownMonsters`, `otherOwnMonsters`; `atk`, `def`, `dur`: `turn` or `perm`, `faceUp` |
| `negate` | `what`: `attack` or `link` (the card/effect just before this one on the chain) |
| `setPos` | `pos`: `atk` or `def` (the attacker) |
| `flipAll` | flips every face-down monster |

`when` conditions: `summonedAtkGte: n`, `belowIsSpellTrap: true`, `subjectPos: 'atk'|'def'`.

## Passives: the golden rule
The numbers in the engine are only defaults. A card bends them with a passive
`{ rule, value, op?, scope?, when? }`:

| rule | default | example |
|---|---|---|
| `atk`, `def` | 0 | `{ rule: 'atk', value: 700, scope: 'equipped' }` |
| `attacksPerTurn` | 1 | `{ rule: 'attacksPerTurn', value: 1 }` = attacks twice |
| `summonsPerTurn` | 1 | `{ rule: 'summonsPerTurn', value: 1, scope: 'player' }` |
| `handLimit` | 7 | `{ rule: 'handLimit', value: 2, scope: 'player' }` |
| `canAttack`, `canDefend`, `canChangePosition` | true | `{ rule: 'canDefend', value: false }` |
| `directAttack`, `pierce` | false | via keywords |
| `attackFirstTurn` | false | player scope |

`op` is `add` for numbers (default) or `set`. `scope`: `self`, `equipped`, `ownMonsters`, `foeMonsters`,
`allMonsters`, `player`, `foePlayer`. Passives only work while the card is face-up.

## Adding a new mechanic
Everything is a registry, so a new mechanic is also a new file (or in your set file, before `registerSet`):
```js
TC.registerRule('canTribute', { default: true, label: 'Can be Tributed', describe: p => '...' });
TC.registerOp('mill', { text: a => 'send ' + a.n + ' cards from the top of your deck to the graveyard',
                        run: (g, link, a) => { /* change g, return a short description */ return 'mills ' + a.n; } });
TC.registerCond('foeLpBelow', { check: (g, link, v) => g.players[1 - link.pi].lp < v });
TC.registerKeyword('berserk', { label: 'Berserk', text: '...', passives: [{ rule: 'attacksPerTurn', value: 1 }] });
```
A new rule only needs the engine to ask `TC.rule(...)` somewhere; the built-in rules already do for attacks,
Summons, hand size, positions and defending. `TC.api` has helpers: `drawCards`, `gainLP`, `damageLP`,
`destroyMon`, `destroyST`, `flipUp`, `say`, `note`.

## Checklist for a new set
1. Add `src/sets/NN-name.js` with `TC.registerSet`.
2. `node tests/engine.test.js` (validates every card, plays hundreds of random duels).
3. Add a test for any card with unusual behaviour (see "golden rule" tests).
4. `node build.js`, then `NODE_PATH=$(npm root -g) node tests/ui.smoke.js`.
5. Publish `dist/otaku-showdown.html`.

## Ban / limit lists (formats)
Copy limits live in a format, not on each card. Add `src/sets/NN-format.js`:
```js
TC.registerFormat({ id: 'season1', name: 'Season 1', limits: { darklord: 1, robot: 0 } });  // 0 = banned
TC.format = 'season1';   // the active format; the editor, validation and online play all use it
```
Both players must run the same cards and format; online play compares `TC.contentHash()` and refuses a mismatch.
