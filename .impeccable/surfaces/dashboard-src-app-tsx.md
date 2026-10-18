---
version: 1
slug: "dashboard-src-app-tsx"
primary_target: "dashboard/src/App.tsx"
related_targets: []
---

# Dashboard PWA (fit.ittyy.dev)

Scope: the whole dashboard PWA: Today, Training, Running, Body, Insights. Mode: Operate.

Audience and job: the owner, on a Pixel 9, one hand, mostly mornings and right after logging a meal.
The first screen answers "today so far": kcal eaten and kcal / protein left. Yesterday's Claude
analysis sits directly below it (user override of the spec, which put the analysis first).
Avoid: generic SaaS card grids, and density (too many numbers at once).

Constraints: read-only except Sync now; English UI; Thai analysis text; fake data in any screenshot.

## Direction contract

THESIS: Today is a thermal till roll that prints as you eat. Meals are line items, the day's target
is the bill, and what's left is printed big like change due. Refuses the default of rings, stat
tiles and a grid of identical cards.

OWN-WORLD: Purple thermal ink on cool white paper, neutrals snapped to a six-step paper-to-ink ramp
(#fbfbf8 #efeef3 #dcd9e8 #a7a1c4 #5e5694 #2d2470). The slip has serrated torn edges. A pink
end-of-roll stripe (#e0307a) means only "nearly out or over" and appears nowhere else. Figures in
Martian Mono at four size steps; UI and Thai text in Anuphan. Tab bar is a solid ink-purple field. Dark mode keeps the same ramp plus one night ground (#17132e) below ink, so the ink tab field still reads; the slip stays paper.
Charts: violet #5a4bd1 and green #14906c, HR zones as a one-hue violet ramp.

STORY: Glance: how much is left today. Then: what Claude said about yesterday, whether recovery was
recorded, and the week's training at a glance. Act: Sync now, or open openGym / Claude.

FIRST VIEWPORT: Slim header (Fitness Hub, "synced 08:12", Sync now icon). The paper slip fills the
width: date line, meals as line items (time, name, kcal) each with a rule drawn to its exact share
of the target, a subtotal rule, then KCAL LEFT at hero size and PROTEIN LEFT beside it. The slip's
torn bottom edge leads into "Yesterday" (Claude's Thai title and first lines). Bottom tab bar.

FORM: Till Roll, own list position 6 of 7, assigned by the roll. seed:b5270d6124df51eb
Raises: one mono face at four steps (Emigre); bars to exact scale (Labanotation); pink reserved for
one state (Boarding pass); macros and photo open on tap (Streaming wall); fixed neutral ramp
(Exposure record). Signature interaction: Sync now feeds the roll: new lines print in from the top
edge with a short paper-feed motion. Receipt grammar lives on Today only; other tabs are plain
product screens in the same ink and type.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
