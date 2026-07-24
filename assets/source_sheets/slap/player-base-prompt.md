# Player base sprite prompt

Generated with the built-in `image_gen` tool on 2026-07-24.

## Inputs

- `C:/team-project/ssal-fighter-app/assets/icon.png`: primary identity and emotional-style anchor
- `assets/app-icon.png`: office outfit and confident action reference
- `assets/char/char_idle.png`: prior idle composition reference
- `assets/char/char_hit.png`: prior hit-reaction composition reference

## Final prompt

Use case: stylized-concept

Asset type: production sprite atlas for a Korean mobile slap-fighting game

Create one clean 3-by-3 sprite atlas of the same rice-grain office intern character. Panel order: neutral ready idle; right-hand wind-up; right-hand side slap; left-hand wind-up; left-hand side slap; spin follow-through; cheek-squashed hit reaction; limbo dodge; two-fist victory.

Preserve the original rice grain's upright oval silhouette, dot eyes, curved mouth, coral oval cheeks, tiny feet, and hand-drawn personality. Use a minimal white shirt collar, yellow tie, charcoal trousers, and tiny shoes. Hands are simple rounded mascot palms. Use a thick, slightly imperfect soft-black outline, flat warm-white fill, and restrained cream shading. Keep the same identity, proportions, face placement, and outfit in all panels.

The slap must travel laterally into an off-screen opponent with a curved coral motion arc and read as a slap rather than a forward push. Use exact equal cells, generous padding, no labels, and a flat solid green chroma-key background. No cast shadow, floor, props, text, logo, watermark, realistic anatomy, extra limbs, glossy anime rendering, or scenery.

## Output contract

- Source atlas: `player_base_atlas.png`
- Runtime cells: 512x512 RGBA
- Background removal: installed `remove_chroma_key.py` helper with soft matte, despill, and one-pixel edge contraction
- All four corners and the outer two-pixel border must have alpha 0
