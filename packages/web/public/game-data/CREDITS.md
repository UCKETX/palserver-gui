# Game data credits

Pal and item catalogs (`pals.json`, `items.json`) and their icons are used to
label IDs in the UI (giving items/Pals, moderation lists, etc.).

- **Pal icons** (`pals/`): carried over from the v1 palserver-GUI assets.
- **Item icons** (`items/`): sourced from [paldb.cc](https://paldb.cc)'s CDN,
  fetched with permission (project maintainer is a paldb.cc contributor).
- **Passive-skill catalog** (`passives.json`): internal ids, names and ranks
  from [paldeck.cc](https://paldeck.cc) (project maintainer is a contributor).
  Passives have no unique in-game artwork — the UI draws the rank badge itself.
- **Active-skill catalog** (`activeSkills.json`): names from
  [paldb.cc](https://paldb.cc)'s `Active_Skills` index (`EPalWazaID`), elements
  joined from [paldeck.cc](https://paldeck.cc)'s skills data by internal id.

`passives.json` / `activeSkills.json` are regenerated with
`node scripts/fetch-skills-passives.mjs`.

All Palworld artwork is © Pocketpair, Inc. These icons are bundled only to
label in-game entities within this management tool.
