# Garaetteok foe atlas prompt

Use case: stylized-concept
Asset type: production game-character sprite atlas, one 3-by-3 sheet
Primary request: Redesign the garaetteok opponent as a simple mascot in the same 2D rice-grain world as Images 1 and 2, preserving only the elongated white rice-cake and navy vice-president coat concept from Images 3-5.
Input images: Image 1 is the authoritative style, proportions, flat color, expressions, and lateral open-palm slap reference; Image 2 is the original rice-grain emotional-style reference; Images 3-5 are concept-only references for idle, hit, and KO identity. Reject their realistic human head/body, face, hair, anime rendering, detailed tailoring, lighting, and shading.
Scene/backdrop: a perfectly flat uniform solid #00ff00 chroma-key field across the whole canvas and both empty cells; no floor, shadows, gradients, texture, panels, frames, or lighting variation. Never use #00ff00 in the subject.
Subject: one cute elongated white garaetteok cylinder mascot, tall but softly rounded and slightly flexible, with a simple rounded top and bottom, dot eyes, tiny simple mouth, coral oval cheeks, stubby noodle limbs, mitten-like hands, absolutely no hair, sideburns, eyebrows, or realistic face. Outfit cue: a simplified short navy vice-president coat with tiny warm-gold trim and one muted-gold tie, wrapped around the lower half of the rice cake; no human torso, trousers, or shoes. Lock the exact long rice-cake silhouette, face height, coat, trim, tie, and proportions across all seven poses.
Style/medium: clean hand-drawn 2D mascot sprite; rounded charcoal-black outline of consistent medium thickness; flat warm colors; minimal highlight only; no complex shading. Match Image 1's compact mascot language while retaining the recognizable tall silhouette.
Composition/framing: exact 3-by-3 grid of nine equal square cells with straight, even, clearly visible white gutters. Center the whole character at consistent scale with generous padding; nothing crosses a boundary. Order: top idle / windup / slap_left; middle slap_right / exaggerated cheek-squash hit / dodge; bottom KO / completely empty solid-key cell / completely empty solid-key cell.
Action direction: both slap cells show a decisive SIDEWAYS SWING using one large readable OPEN PALM, fingers together, plus a broad curved coral/orange motion arc and follow-through. The palm moves laterally; never presses or pushes an invisible wall.
Constraints: identical elongated white rice cake, face, navy coat, gold trim/tie, palette, and line weight across all seven poses; dot eyes, simple mouths, coral cheeks; no text, labels, watermark, UI, border, extra objects. Bottom-middle and bottom-right contain only #00ff00.
Avoid: realistic human face/head/anatomy, hair, sideburns, eyebrows, detailed fingers, realistic suit body, pants, shoes, anime/game-promo painting, 3D, dramatic light, cast shadows, translucent effects, frontal pushing, two hands pressing forward.

## Targeted correction prompt (one pass)

Use case: precise-object-edit
Input images: Image 1 is the exact atlas edit target; Image 2 is the open-palm slap reference; Image 3 is the original emotional-style reference.
Primary request: Change only the MIDDLE-LEFT cell (row 2, column 1). Replace its unclear fist/turn gesture with a decisive horizontal slap toward image-left, ending in one large clearly visible OPEN PALM with fingers together and a connected wrist, plus a broad curved coral/orange arc and follow-through.
Invariants: preserve the other eight cells, exact grid, solid #00ff00 field, two empty cells, and the same elongated white rice cake, face, navy coat, gold trim/tie, scale, palette, and line weight. No push, punch, invisible wall, text, hair, realistic anatomy, shadows, or extra objects.
