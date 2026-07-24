# Rice-grain wardrobe generation notes

These atlases were generated and white-tone corrected with the built-in
ImageGen workflow, then split into the runtime PNGs in `assets/skins/poses/`.
The original rice character at
`C:/team-project/ssal-fighter-app/assets/icon.png` and the canonical player
atlas at `../player_base_atlas.png` were used as the visual references.

## Shared final prompt

Create one square 3x3 sprite atlas for the same cute Korean rice-grain mascot.
Match the reference identity exactly: a plump white vertical rice/egg body,
rounded charcoal-black outline, two dot eyes, tiny U smile, coral oval cheeks,
simple black tube limbs, round hands and oval feet.  Preserve identical body
proportions, face placement, line weight, camera scale, and outfit details in all
nine cells.  Use clean hand-drawn 2D mobile-game art with a soft-white rice body
(`#FFFDF8` base, `#FFFFFF` highlight, `#F4F0E8` neutral shadow), charcoal
outlines, coral accents, and restrained highlights.  Do not tint exposed body
beige, tan, yellow, or gray.  No text, no
labels, no extra characters, no props unless the outfit specification asks for
one, no shadows connecting cells.

Cell order is exact, left-to-right and top-to-bottom:

1. idle, front three-quarter, relaxed open hands
2. windup_right, right arm pulled clearly behind the body, open palm
3. slap_right, right open palm crossing laterally at cheek height with a curved
   motion arc and clear follow-through
4. windup_left, left arm pulled clearly behind the body, open palm
5. slap_left, left open palm crossing laterally at cheek height with a curved
   motion arc and clear follow-through
6. spin recovery, controlled half-turn with curved motion arcs
7. hit reaction, cheek compressed sideways, tiny star accents
8. dodge, compact side lean with both hands visible
9. win, cheerful raised hands

Every slap must read as a fast open-palm cheek strike, never a shove, punch,
wave, or object swing.  Keep each full character centered inside its cell with
generous safe margins and no cropping.  Place the atlas on one perfectly flat,
uniform pure chroma-green `#00FF00` background with crisp separation and no
green reflections on the character.

## Outfit variants

| Runtime id | Outfit specification appended to the shared prompt |
| --- | --- |
| `work_glove` | Warm orange work shirt, small beige utility vest, off-white work gloves, yellow cuffs. |
| `rubber_glove` | Cream kitchen apron over a coral shirt, coral rubber cleaning gloves. |
| `pasu` | Rumpled white office shirt, coral necktie, small wrist and shoulder patches; lovable exhausted office worker. |
| `suit` | Tailored charcoal executive suit, crisp cream shirt, coral tie; simple and premium. |
| `golf` | Cream-and-coral polo, restrained plaid trousers, yellow visor, one white golf glove; never draw a golf club. |
| `hiking` | Cream-and-coral hiking jacket, compact backpack, charcoal gloves, yellow neck scarf. |
| `cyborg` | Cream tech jumpsuit with sparse coral circuit seams and compact charcoal-and-gold gauntlets; face remains organic and cute. |
| `midas` | Cream wrap coat, coral sash, elegant gold gauntlets and restrained gold trim. |
| `slap_king` | Cream chairman jacket, coral sash and cape, gold epaulets, belt, tiny crown; never draw a throne. |

## Post-processing

Each atlas is cropped cell-by-cell with a small inset, passed through the
ImageGen skill chroma-key helper using soft matte/despill and one-pixel edge
contraction, normalized to 500 px, and padded transparently to 512x512. The
rebuild script detects the two real divider bands on each axis instead of using
equal thirds, preventing shifted white gutters from entering runtime sprites.
The nine pose files and wardrobe thumbnail use those normalized transparent
sprites.

Run from `assets/source_sheets/slap`:

```powershell
py -3 rebuild_runtime_sprites.py
```

## Shared white-tone edit prompt (2026-07-25)

Use case: precise-object-edit

Asset type: production 3x3 sprite atlas for a mobile game

Image 1 is the target wardrobe atlas. Image 2 is the approved white-body base
atlas and exact body-tone reference. Image 3 is the original mascot and an
additional style reference.

Change only exposed rice-grain body/skin on every pose from cream/yellow ivory
to clean soft-white rice tone: base `#FFFDF8`, highlights `#FFFFFF`, and
extremely subtle neutral pale-gray shadows around `#F4F0E8`. Preserve the
target outfit and colors, face, cheeks, all poses and silhouettes, proportions,
hands, slap motion arcs, cell order, flat green background, full 3x3 layout,
and white gutters. Do not redesign, simplify, add accessories, alter garment
colors or expressions, crop a pose, add an outer frame, add stray marks, or
move the grid. Color correction only on exposed rice body/skin.

For `slap_king`, also require: reconstruct a clean regular 3x3 grid with white
gutters only between cells; no white line, border, or strip may appear inside a
green cell or around the outer frame.
