# Inline formatting in rendered messages

`utils/markdown.ts` sanitizes model output and display-regex replacements through DOMPurify. Its attribute hook calls the pure `utils/inline-decoration.ts` validator. This affects display only: saved messages, regex replacement strings and prompts are unchanged. Existing messages may display formatting that was previously stripped.

Only listed properties with accepted values survive. Declarations are rebuilt as `property: value`, separated by `; `; app.css depends on that serialization when detecting explicit text colours. `!important` is removed. CSS variables, escapes, comments, arbitrary functions and resource URLs are rejected. Attribute input is capped at 8192 characters and each value at 2048.

| Group | Supported properties and values |
| --- | --- |
| Colour | `color`, `background-color`, `text-decoration-color`: named/hex colours and non-nested rgb/rgba/hsl/hsla functions |
| Font size | `font-size`: 8–64px, 0.5–3em, 0.5–4rem or 50–300%; emitted inside `clamp(8px, value, 64px)` to bound nested relative sizes |
| Font family | `font-family`: up to eight literal family names, quoted multiword names and generic families; uses fonts available to the browser, without fetching additional fonts |
| Font face | `font-weight`: normal/bold/lighter/bolder or 1–1000; `font-style`: normal/italic/oblique; `font-variant`: normal/small-caps |
| Line spacing | `line-height`: normal, 1–3, 100–300%, 12–128px, 1–3em or 0.75–8rem |
| Character spacing | `letter-spacing`: normal, -2–8px, -0.1–0.5em or -0.125–0.5rem; `word-spacing`: normal, 0–16px or 0–1em/rem |
| Text | `text-align`: left/right/center/justify/start/end; `text-transform`: none/capitalize/uppercase/lowercase/full-width |
| Decoration | `text-decoration` and `text-decoration-line`: none/underline/overline/line-through; `text-decoration-style`: solid/double/dotted/dashed/wavy; thickness and underline offset accept bounded border-width lengths and auto; thickness also accepts from-font |
| Spacing | `padding`, `margin`, their physical side and logical inline/block variants: 0–64px or 0–4em/rem; margins also accept auto. Negative spacing and percentages are rejected |
| Borders | `border`, physical/logical side shorthands, colour/style/width longhands: validated colours, standard border styles, 0–8px or 0–0.5em/rem widths and thin/medium/thick |
| Corners | `border-radius` and physical/logical corner longhands: 0–64px, 0–4em/rem or 0–50%; shorthand also supports separate horizontal/vertical radii |
| Backgrounds | `background` and `background-image`: none and bounded linear/radial/conic gradients; background also accepts a solid colour |

Gradients accept up to four layers, up to seventeen comma-separated segments per gradient, numeric directions and bounded colour-stop positions. Functions cannot nest except for colour functions inside a gradient; no images, URLs, variables, repeating gradients or background positioning are accepted. This is a supported subset, not arbitrary CSS parsing.

Position, offsets, z-index, transforms, dimensions, display/flex/grid, floats, animations, shadows and custom properties remain blocked. DOMPurify still controls tags, attributes, links, scripts and event handlers independently. Legacy `<font color>` remains supported; `<font size>` is not enabled by this change.

Details panels retain their dark/accent defaults. Inline formatting may customize typography, spacing, borders and backgrounds, but the summary's end padding reserves the arrow slot. The arrow stays centred with multiline titles and custom font sizes. The existing DOM patcher preserves open/closed state when streaming text is reconciled.

`inline-decoration.test.ts` covers imported panel headers, all supported property groups, numeric boundaries, idempotent font-size clamps, malformed gradients, unknown properties and resource/positioning payloads. Browser validation must also exercise actual display-regex replacements, details toggling and narrow viewports.
