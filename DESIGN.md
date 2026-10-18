---
name: Fitness Hub
description: A personal fitness dashboard printed in purple thermal ink on cool white paper.
colors:
  paper: "#fbfbf8"
  ground: "#efeef3"
  rule: "#dcd9e8"
  faint: "#a7a1c4"
  ink-2: "#5e5694"
  ink: "#2d2470"
  night-ground: "#17132e"
  tab-ink-2: "#bdb7e6"
  end-of-roll-pink: "#e0307a"
  series-violet: "#5a4bd1"
  series-green: "#14906c"
  series-violet-dark: "#8c7ff0"
  series-green-dark: "#26a07c"
  zone-1: "#b0a6ee"
  zone-2: "#8c7ff0"
  zone-3: "#6a5adf"
  zone-4: "#3f2fa8"
typography:
  figure-xl:
    fontFamily: "'Martian Mono Variable', ui-monospace, monospace"
    fontSize: "3.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
    fontVariation: "'wdth' 87.5"
  figure-l:
    fontFamily: "'Martian Mono Variable', ui-monospace, monospace"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
    fontVariation: "'wdth' 87.5"
  figure-m:
    fontFamily: "'Martian Mono Variable', ui-monospace, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
    fontFeature: "tnum"
    fontVariation: "'wdth' 87.5"
  figure-s:
    fontFamily: "'Martian Mono Variable', ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "0.04em"
    fontFeature: "tnum"
    fontVariation: "'wdth' 87.5"
  headline:
    fontFamily: "'Anuphan Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title-slip:
    fontFamily: "'Anuphan Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title-analysis:
    fontFamily: "'Anuphan Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.45
  title-section:
    fontFamily: "'Anuphan Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "'Anuphan Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  prose:
    fontFamily: "'Anuphan Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "'Anuphan Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  tab:
    fontFamily: "'Anuphan Variable', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
rounded:
  hairline: "2px"
  sm: "4px"
  tooltip: "6px"
  pill: "999px"
spacing:
  tooth: "9px"
  row: "12px"
  section-inner: "14px"
  gutter: "16px"
  slip: "22px"
  section: "36px"
  tab-h: "64px"
  rail: "96px"
components:
  slip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "27px 22px 31px"
  tab-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.tab-ink-2}"
    typography: "{typography.tab}"
    height: "64px"
  tab-bar-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  pill-link:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "40px"
  pill-link-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.paper}"
  segment:
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  segment-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
  icon-button:
    textColor: "{colors.ink}"
    size: "44px"
  icon-button-hover:
    backgroundColor: "{colors.rule}"
  meter:
    backgroundColor: "{colors.rule}"
    rounded: "{rounded.hairline}"
    height: "4px"
  tooltip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tooltip}"
    padding: "8px 10px"
---

# Design System: Fitness Hub

## Overview

**Creative North Star: "The Till Roll"**

The dashboard is printed, not rendered. Purple thermal ink sits on cool white paper, and every neutral in the interface is a step on one fixed ramp running from paper to ink. The Today screen is a literal receipt: a paper slip with serrated torn edges, meals as line items with a rule drawn to their exact share of the day's target, a dashed tear before the totals, and what is left of the day printed big like change due. The other tabs are plain product screens in the same ink and the same two faces; they borrow the ink, the hairline rules and the mono figures, but not the receipt grammar.

Density is low and vertical. One column, at most 40rem wide, stacked sections separated by generous space and divided internally by single hairline rules instead of cards. Numbers are always set in a condensed monospace at one of four sizes, so figures line up and read as printed output; words, including Claude's Thai analysis, are set in a rounded Thai-capable sans. Colour beyond the ink is functional only: two chart series, a one-hue violet ramp for heart-rate zones, and a single pink that means "nearly out or over".

The system rejects rings, stat tiles and grids of identical cards. Data is shown as rows, bars drawn to exact scale, and charts with a table fallback.

**Key Characteristics:**
- One fixed paper-to-ink neutral ramp; dark mode reuses it plus one night ground.
- Figures in condensed Martian Mono at exactly four sizes; text in Anuphan.
- Hairline-ruled rows, never cards; the slip is the only raised object.
- Bars and rules drawn to exact proportion of a target.
- Solid ink-purple tab field at the bottom on phones, a left rail on desktop.
- Pink reserved for one state.

## Colors

A cool, near-monochrome violet system: ink on paper, with two quiet chart hues and one alarm pink.

### Primary
- **Thermal Ink** (ink): all primary text, the solid tab-bar field, filled pills, pressed segments, meter and line-rule fills, text selection. The colour of the whole product; the app icon and the browser theme colour are this ink.

### Secondary
- **Chart Violet** (series-violet; series-violet-dark at night): first data series, weekly bars, the muscle "this week" bar, and the keyboard focus ring.
- **Chart Green** (series-green; series-green-dark at night): second data series only (burned kcal, the 4-week-average tick). Validated as a pair with Chart Violet for categorical contrast on paper and on the night ground.
- **Zone Ramp** (zone-1 to zone-4): heart-rate zones Light, Moderate, Vigorous, Peak, as one violet hue stepping darker with intensity. Ordinal, never categorical.

### Tertiary
- **End-of-Roll Pink** (end-of-roll-pink): the 8px stripe printed down the slip's right edge when under 10% of the day's kcal target is left, and the KCAL OVER figure. Nothing else in the interface.

### Neutral
- **Receipt Paper** (paper): the slip, tooltips, text on ink fields.
- **Counter Ground** (ground): page background behind everything.
- **Hairline** (rule): row dividers, meter tracks, chart gridlines, icon-button hover wash.
- **Faded Ink** (faint): dashed tear lines, disclosure chevrons, link underlines on the slip, chart cursor.
- **Second Ink** (ink-2): secondary text, units, captions, axis ticks, goal reference lines.
- **Night Ground** (night-ground): dark-mode page background only, one step below ink so the ink tab field still reads.
- **Tab Ink, Resting** (tab-ink-2): inactive tab labels on the ink field in light mode. The one neutral off the six-step ramp, chosen for legibility on ink; dark mode uses faint instead.

In dark mode the ramp inverts in place: ground becomes night-ground, rule becomes ink, faint becomes ink-2, ink-2 becomes faint, ink becomes paper, and the page reads as a receipt on a dark counter. The slip and tooltips stay paper with thermal-purple ink.

### Named Rules
**The Fixed Ramp Rule.** Every neutral is one of paper, ground, rule, faint, ink-2, ink, plus night-ground in dark mode. No tints, no opacity-mixed greys; a new surface picks a step.

**The End-of-Roll Rule.** Pink means only "nearly out or over". It never decorates, never marks a link, never colours a chart series.

**The Slip Stays Paper Rule.** In dark mode the slip and chart tooltips keep paper ground and thermal-purple ink; only the counter around them goes dark.

## Typography

**Display / Figure Font:** Martian Mono Variable (with ui-monospace), always at 87.5% width with tabular numerals
**Body Font:** Anuphan Variable (with Noto Sans Thai, system-ui)

**Character:** A condensed mono that reads like a thermal printer against a soft, open Thai-Latin sans. The mono carries every number; the sans carries every sentence, including long Thai analysis.

### Hierarchy
- **Figure XL** (Mono 600, 3.5rem, line-height 1, -0.04em): KCAL LEFT on the slip. One per screen at most.
- **Figure L** (Mono 600, 1.75rem, 1.1): PROTEIN LEFT, the latest-run figures, three-up figure groups.
- **Figure M** (Mono 400, 0.9375rem): figures at the right end of rows, line-item kcal.
- **Figure S** (Mono 400, 0.75rem, 0.04em): units, times, chart ticks, receipt labels (EATEN, KCAL LEFT), score meta.
- **Headline** (Anuphan 700, 1.75rem, 1.15, -0.02em): page titles on Training, Running, Body, Insights.
- **Slip Title** (Anuphan 700, 1.5rem, 1.2): "Today" at the head of the slip.
- **Analysis Title** (Anuphan 700, 1.25rem, 1.45): Claude's Thai headline; the loose leading leaves room for Thai tone marks.
- **Section Title** (Anuphan 700, 1.125rem, 1.3): section heads.
- **Body** (Anuphan 400, 1rem, 1.5) and **Prose** (1.7 line-height, max 65ch): UI copy and analysis text.
- **Label** (Anuphan 400, 0.8125rem): row subtitles, legends, figure labels, table headers; 0.875rem for notes and data tables.
- **Tab** (Anuphan 500, 0.75rem; 700 when current).

### Named Rules
**The Four Figures Rule.** Numbers are set in mono at figure-s, figure-m, figure-l or figure-xl, nothing in between. Words never use the mono except as labels printed alongside data: receipt labels on the slip, score readouts beside Claude's analysis, the PR tag.

**The Receipt Caps Rule.** Uppercase mono with 0.04em tracking is printed data, never a heading: the slip's date line and totals (EATEN, KCAL LEFT), the score readout under Claude's analysis (RECOVERY 70), the PR tag. Section and page labels are sentence-case sans, and nothing sits above a title as a label.

## Layout

A single column, max-width 40rem, centred, with a 16px gutter and safe-area insets honoured top and bottom. Sections stack with a 36px gap; inside a section, head and content sit 14px apart. Rows are 12px top and bottom with a hairline above each and below the last. Three-up figure groups use a 3-column grid with a 16px by 12px gap.

On phones a fixed 64px tab bar spans the bottom (plus the safe-area inset) with five equal tabs. At 960px and up it becomes a 96px rail pinned to the left, tabs stacked in 72px rows starting 72px from the top; the content column stays 40rem.

Today orders the slip first, then Claude on yesterday, then Last night, then So far this week. While data refreshes, the main column drops to 60% opacity rather than showing a spinner over content.

## Elevation & Depth

Flat by default. Depth is conveyed by the two-tone paper-on-ground relationship and by hairline rules, not by stacked surfaces. Exactly two things lift: the slip, which casts a soft ink-tinted drop shadow that follows its torn edges, and chart tooltips, which float above the plot.

### Shadow Vocabulary
- **Slip drop** (`filter: drop-shadow(0 1px 1px rgb(45 36 112 / 0.1)) drop-shadow(0 8px 14px rgb(45 36 112 / 0.14))`): on the slip wrapper only; a filter rather than box-shadow so it traces the serrated mask.
- **Tooltip float** (`box-shadow: 0 1px 1px rgb(45 36 112 / 0.08), 0 6px 18px -6px rgb(45 36 112 / 0.22)`; dark: `0 1px 1px rgb(0 0 0 / 0.3), 0 8px 24px -8px rgb(0 0 0 / 0.6)`): chart tooltips.

### Named Rules
**The One Slip Rule.** The slip is the only raised paper object in the product. Sections elsewhere are never boxed, filled or shadowed.

## Shapes

Soft but small. Interactive controls are full pills (999px) or circles (the 44px icon button). Data marks use tight radii: 2px on meters and line rules, 4px on bar ends, zone-bar ends, meal photos and the focus ring, 3px on legend keys, 6px on tooltips. Bars are squared at their origin and rounded only at the growing end.

The signature silhouette is the slip: a paper rectangle whose top and bottom edges are cut into a 9px saw-tooth by a CSS mask, with dashed 1.5px tear lines in faded ink dividing its head, lines, totals and change. The app icon repeats it: a paper slip with a torn bottom on an ink tile.

## Components

### Buttons
- **Shape:** full pill (999px) or circle.
- **Pill link (primary):** ink fill, paper text, 600 weight at 0.875rem, 40px min-height, 14px side padding. Hover shifts to ink-2. Used for outbound actions (Open Claude, openGym).
- **Icon button:** 44px circle, transparent, ink glyph; hover washes to rule. Sync now spins its glyph (1s linear) while busy.
- **Text button:** no fill, 600 weight, 1px underline at 3px offset ("Read all and the recommendations", "Show all runs").
- **Focus:** 2px Chart Violet outline at 2px offset, 4px radius; on the ink tab field the outline turns paper and insets 4px.

### Chips
- **Segmented filter:** horizontally scrolling pills, 36px high, 1px rule border, transparent. Pressed: ink fill, paper text, ink border.

### Cards / Containers
- **None as a pattern.** Content sits directly on the ground, grouped by section titles and divided by 1px rule hairlines. The slip is the sole container.

### Navigation
- **Tab bar:** solid ink field, five tabs with a 22px line icon (1.8 stroke) over a 0.75rem label. Resting tabs in tab-ink-2; the current tab is paper, 700 weight, 2.4 stroke. Becomes a left rail at 960px.
- **Top bar:** "Fitness Hub" wordmark in 700 sans, the sync time in figure-s ink-2, and the Sync now icon button. Failures appear once beneath it as a quiet inline notice with an alert glyph, never a banner.

### Stat rows and meters
Label left in 500 sans, figure right in figure-m mono with units at figure-s ink-2, an optional sub-line in label ink-2. A 4px meter on a rule track, filled in ink (ink-2 in dark mode) to the exact proportion of the target, capped at full.

### The Slip (signature)
Paper, 22px side padding, 9px saw-tooth top and bottom. Centred head (Slip Title plus an uppercase mono date), tear line, meal lines (time in figure-s, name in 500 sans, kcal in figure-m, a chevron), each with a 3px rule under name and kcal drawn to the meal's exact share of the day's target. Tapping a line opens macros, photo and items in place. Then a tear, uppercase mono totals with a protein meter, a tear, and the change block: KCAL LEFT at figure-xl beside PROTEIN LEFT at figure-l. A dashed foot link closes it. Newly arrived meals print in with a 0.7s paper-feed: clipped from the top and dropping 12px, eased `cubic-bezier(0.16, 1, 0.3, 1)`.

### Charts
Recharts on a 200px plot: rule gridlines, no vertical grid, ink-2 mono ticks at figure-s, goal as an ink-2 4/3 dashed reference line, no entry animation. Every chart offers a "Show as table" disclosure. HR zones render as a single 14px bar of zone segments split by 2px gaps with 4px rounded ends.

## Do's and Don'ts

### Do:
- **Do** pick every neutral from the paper-to-ink ramp; in dark mode add only night-ground.
- **Do** set every number in Martian Mono at 87.5% width with tabular numerals, at one of the four figure sizes.
- **Do** draw bars, line rules and meters to exact proportion of their target, capped at 100%.
- **Do** divide content with 1px rule hairlines between rows instead of boxing it.
- **Do** keep the slip paper with thermal-purple ink in dark mode.
- **Do** give every chart a table view and use the zone ramp in order for HR intensity.
- **Do** honour reduced motion: the paper-feed and every transition collapse to near zero.

### Don't:
- **Don't** use End-of-Roll Pink for anything other than nearly out or over.
- **Don't** build rings, stat tiles or grids of identical cards.
- **Don't** add a second raised surface; the slip is the only shadowed object besides tooltips.
- **Don't** carry the slip's grammar (torn edges, dashed tears, line items, change block) onto tabs other than Today.
- **Don't** put an uppercase label above a title; uppercase mono is reserved for printed data.
- **Don't** introduce intermediate figure sizes or set running text in the mono.
- **Don't** colour HR zones categorically; they are one violet hue stepping darker.
