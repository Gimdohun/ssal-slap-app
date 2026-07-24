# Promotion-opponent atlas direction contract

The opponent is rendered on the right side of battle and every occupied cell
must face or track three-quarter **screen-left**, toward the player.

Cell order is `idle`, `windup`, `slap_left`, `slap_right`, `hit`, `dodge`,
`ko`, followed by two empty chroma-key cells. Most atlases use green; atlases
whose character palette overlaps green may use magenta. The slap names select which hand is
used; they do not select the target direction. Both slap poses strike
screen-left and keep their motion arcs on the left. The windup pulls the hand
screen-right/back, `hit` recoils screen-right, `dodge` retreats screen-right
while watching left, and `ko` falls screen-right.

This fixed-side rule supersedes the older front-facing and mirrored-direction
wording in the individual historical prompt files.

Rebuild the 126 runtime PNGs after editing the atlases:

```powershell
py -3 ..\rebuild_foe_sprites.py
```

The rebuild deliberately leaves the boss-only `ricebag_king_guard`,
`ricebag_king_special`, and `ricebag_king_taunt` runtime images unchanged.
It samples either green or magenta chroma automatically. For barley, corn,
potato, sweet potato, wheat, and pea artwork, only the key-colored region
connected to the cell border is removed, so leaves, pods, and enclosed clothing
details remain opaque.
