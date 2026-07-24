# Nurungji foe atlas prompt

Use case: stylized-concept
Asset type: production game-character sprite atlas, one 3-by-3 sheet
Primary request: Redesign the nurungji opponent as a simple mascot in the same 2D rice-grain world as Images 1 and 2, preserving only the golden scorched-rice disk and brown director-suit concept from Images 3-5.
Input images: Image 1 is the authoritative style, proportions, flat color, expressions, and lateral open-palm slap reference; Image 2 is the original rice-grain emotional-style reference; Images 3-5 are concept-only references for idle, hit, and KO identity. Reject their human anatomy, realistic face, hair, moustache, anime rendering, detailed tailoring, lighting, and shading.
Scene/backdrop: a perfectly flat uniform solid #00ff00 chroma-key field across the whole canvas and both empty cells; no floor, shadows, gradients, texture, panels, frames, or lighting variation. Never use #00ff00 in the subject.
Subject: one cute round golden nurungji disk mascot, slightly irregular and flatter than a ball, with a few simple toasted-rice flecks and a darker caramel rim; dot eyes, tiny simple mouth, coral oval cheeks, stubby noodle limbs, mitten-like hands, absolutely no hair, facial hair, or realistic face. Outfit cue: a simplified cropped chocolate-brown director jacket and tiny warm-orange tie wrapped around the disk, with no human torso, trousers, or shoes. Lock silhouette, flecks, face location, jacket, tie, and proportions across all seven poses.
Style/medium: clean hand-drawn 2D mascot sprite; rounded charcoal-black outline of consistent medium thickness; flat warm colors; minimal highlight only; no complex shading. Match Image 1's compact bean proportions and Image 2's innocent charm.
Composition/framing: exact 3-by-3 grid of nine equal square cells with straight, even, clearly visible white gutters. Center the complete recurring character at consistent scale with generous padding; nothing crosses a cell boundary. Order left-to-right: top = neutral idle, rotational windup with arm pulled back, slap_left; middle = slap_right, exaggerated cheek-squash hit, nimble side dodge; bottom = KO lying/reclining with X eyes, completely empty solid-key cell, completely empty solid-key cell.
Action direction: both slap cells show a decisive SIDEWAYS SWING using one large readable OPEN PALM, fingers together, plus a broad curved coral/orange motion arc and follow-through. The palm travels laterally across the body; never presses, braces, shoves, or pushes an invisible wall. Windup stores visible rotational energy.
Constraints: one identical nurungji mascot per used cell; identical face, disk silhouette, flecks, brown jacket, tie, palette, and line weight; dot eyes, simple mouths, coral cheeks; no labels, text, numbers, captions, watermark, UI, border, or extra objects. Bottom-middle and bottom-right contain only flat #00ff00.
Avoid: realistic human face/anatomy/proportions, hair, wig, moustache, eyebrows, detailed fingers, realistic suit body, pants, shoes, anime/game-promo painting, 3D, dramatic light, cast shadows, semi-transparent effects, frontal pushing pose, two hands pressing forward.

## Targeted correction prompt (one pass)

Use case: precise-object-edit
Input images: Image 1 is the exact atlas edit target; Image 2 is the open-palm slap reference; Image 3 is the original emotional-style reference.
Primary request: Change only the MIDDLE-LEFT cell (row 2, column 1). Replace its unclear fist/turn gesture with a decisive horizontal slap toward image-left, ending in one large clearly visible OPEN PALM with fingers together and a connected wrist, plus a broad curved coral/orange arc and follow-through.
Invariants: preserve the other eight cells, exact grid, solid #00ff00 field, two empty cells, and the same round golden disk, toasted flecks, face, brown jacket, orange tie, scale, palette, and line weight. No push, punch, invisible wall, text, hair, realistic anatomy, shadows, or extra objects.
