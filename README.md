# Otaku Showdown

An anime-themed card duel built on Yu-Gi-Oh style rules: face-down Set monsters, Tribute Summons, Flip effects,
traps, chains (Spell Speed 1-3), a deck editor, a computer opponent, and friend-vs-friend online play.
Plain JavaScript, HTML and CSS. No framework, no database, no server required.

**The golden rule: a card's text beats the base rules.** Rules like hand limit, attacks per turn and Summons per turn
are defaults that cards can change.

## Play it
- Open `dist/index.html` after `npm run build` (or any static web host).
- Free hosting: push to GitHub, then Settings > Pages > Source: **GitHub Actions**. The included workflow
  (`.github/workflows/pages.yml`) runs the tests, builds, and publishes on every push to `main`.

## Develop
```bash
npm test            # rules engine tests (no dependencies): chains, golden rule, AI fuzz, determinism
npm run build       # bundles src/ into dist/index.html (single standalone file)
npm install         # only needed for the browser tests below
npx playwright install chromium
npm run test:ui     # drives the real screen with clicks (light + dark, a scripted chain)
npm run test:online # two browser pages play a full duel over WebRTC and must stay in sync
```

## Add cards and mechanics
Cards are data. An expansion is one file in `src/sets/` (picked up automatically).
See [docs/ADDING_CARDS.md](docs/ADDING_CARDS.md): every card field, effect op, rule and condition, how to add
new ones, and how ban/limit lists (formats) work. [DESIGN.md](DESIGN.md) covers the rules, chains and online design.

## Layout
| Path | What |
|---|---|
| `src/core.js` | registries (cards, sets, rules, ops, conditions, formats), card and deck validation |
| `src/engine.js` | rules engine, no screen code |
| `src/builtins.js` | built-in rules, keywords, effect ops, conditions |
| `src/sets/` | card sets: `00-core.js`, `01-chain-reaction.js` |
| `src/ai.js` | computer opponent (scores legal actions) |
| `src/duel.js`, `src/editor.js`, `src/online.js`, `src/store.js`, `src/main.js`, `src/template.html` | screens, decks, friend play, page |
| `manifest.js`, `build.js` | load order and bundler |
| `tests/` | engine, UI and online tests |

## Online play
Friends trade two copy/paste codes; the browsers connect directly (WebRTC) and run the same seeded engine,
exchanging only moves. A hash check ends the duel as "Out of sync" if the two games ever diverge.
Limits: no reconnecting after a drop, no relay (TURN) for strict networks, and both browsers hold the full game
state, so it is not cheat-proof. Any engine randomness must use `TC.rand`, never `Math.random`.

## Notes
- No license is included yet; add one (for example MIT) before making the repository public.
- Anime references in card names are generic tropes. Check card art and names before publishing commercially.
