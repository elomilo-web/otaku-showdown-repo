# Otaku Showdown - design notes

Yu-Gi-Oh style duels themed on anime tropes. The golden rule: **a card's text beats the base rules.**
How to add cards and mechanics: `docs/ADDING_CARDS.md`.

## Layout
- `src/core.js` registries (cards, sets, rules, ops, conditions, keywords), card + deck validation
- `src/engine.js` rules engine (pure state, no DOM): turns, summons, battle, chains. Asks `TC.rule()` for every number/switch
- `src/builtins.js` built-in rules, keywords, ops, conditions
- `src/sets/*.js` card sets (auto-loaded, in name order). `00-core.js` Core Set, `01-chain-reaction.js` mini expansion
- `src/ai.js` opponent: scores every legal action from `TC.legalActions`
- `src/store.js` deck storage, `src/duel.js` duel screen (solo + online), `src/online.js` friend play, `src/editor.js` deck editor, `src/main.js` menu/boot
- `manifest.js` load order; `build.js` bundles into `dist/otaku-showdown.html` (publish) and `dist/preview.html` (tests)
- `tests/engine.test.js` rules, chains, golden rule, modularity, AI fuzz; `tests/ui.smoke.js` Playwright with real clicks, `tests/online.smoke.js` two browser pages play each other, `tests/lib/ui-driver.js` shared click driver

## Rules (defaults)
- 8000 LP, start hand 5, hand limit 7 (discard at end of turn), deck-out at your draw loses.
- Turn: Draw, Standby, Main 1, Battle, Main 2, End. No attack on the first turn of the duel.
- 5 monster zones, 5 Spell/Trap zones, 1 Field zone. One Normal Summon or Set per turn. Level 5-6: 1 Tribute, 7+: 2.
- Set monsters are face-down Defense. Flip Summon (Set on an earlier turn) goes to Attack. Attacked or effect-flipped goes face-up Defense. Flip effects trigger when turned face-up.
- Position change once per turn, not the turn it was placed, not after attacking.
- Each monster attacks once per turn. ATK vs ATK: difference to the loser, tie destroys both. ATK vs DEF: no damage unless Pierce.
- Direct attack only if no opposing monster can defend (Cannot Defend monsters don't count); Direct monsters always can.
- Decks 40-60 cards, 3 copies per card. Ban/limit lists are formats (`TC.registerFormat`); no card has its own limit yet.

## Chains
Activating a Spell, Trap, or an effect (Debut/Flip) starts a chain. Attack declarations and Summons open a response window.
The other player may add a face-down Trap (not the turn it was Set) or a Set Quick-Play Spell, then the first player may respond, and so on.
Spell Speed: Normal Spell/monster effect 1, Quick-Play/Trap 2, Counter Trap 3. A response needs speed >= the last link; only Counter Traps answer Counter Traps.
Resolution is last in, first out. A negated link does nothing (a negated Spell/Trap is destroyed).

## Still simplified vs real Yu-Gi-Oh
No Special Summons, Fusion/Ritual, graveyard recursion, Spell Speed timing windows beyond the above, or "when/if" trigger rules.
Only the opponent responds in a window (no self-chaining), and only Set cards respond (hand cards cannot).

## Online play (friend vs friend)
- Transport: a WebRTC data channel set up by swapping two copy/paste codes (invite, reply). No server, accounts or sharing level involved.
- Lockstep: both browsers run the same engine with the same seed (`mulberry32`) and the same decks. Only moves travel: `{t:'move', n, a, h}`.
  `h` is a hash of the visible state; a mismatch ends the duel as "Out of sync" instead of silently diverging.
- Seats: host is seat 0, guest seat 1. The UI always draws me at the bottom (`role()` in duel.js); engine log wording follows `TC.viewer`.
- Both sides compare `TC.contentHash()` (cards, rules data, format) and refuse to play on a mismatch.
- Not covered: reconnecting after a drop (the duel ends), spectators, matchmaking, TURN relay for strict networks.
- Anything in an engine change that uses randomness must go through `TC.rand` (never `Math.random`) or online games will desync.
