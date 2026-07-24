# Player base sprite prompt

Generated with the built-in `image_gen` tool on 2026-07-24 and white-tone
corrected with the same built-in tool on 2026-07-25.

## Fixed battle-side direction revision (2026-07-25)

The runtime player is always on the left side of the stage. Every pose now
keeps a three-quarter **screen-right** orientation toward the opponent. The two
windups alternate arms but pull the striking hand toward screen-left/back, and
both slap poses travel toward screen-right. `hit` recoils screen-left, while
`dodge` retreats screen-left without looking away from the opponent. Do not
mirror an entire pose merely to switch hands.

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
- Background removal: installed `remove_chroma_key.py` helper with a sampled
  saturated key, hard tolerance, one-pixel contraction, and boundary despill
- All four corners and the outer two-pixel border must have alpha 0
- Rebuild command: `py -3 rebuild_runtime_sprites.py`
- Grid dividers are detected from their actual pixels; the rebuild never assumes equal thirds

## White-tone revision prompt (2026-07-25)

Use case: precise-object-edit

Asset type: production 3x3 sprite atlas for a mobile game

Input images: Image 1 is the edit target atlas; Image 2 is the original
rice-grain mascot white-tone reference.

Primary request: change only exposed body/skin from cream/yellow ivory to clean
soft-white rice tone `#FFFDF8`, with highlights `#FFFFFF` and extremely subtle
neutral pale-gray shading around `#F4F0E8`. The body must not read beige, tan,
yellow, or gray.

Preserve every pose, silhouette, proportion, facial feature, cheek, outfit,
motion arc, cell order, green background, 3x3 layout, and gutter. Color
correction only; no redraw, border, or crop.
