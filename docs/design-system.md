# Design system

The visual language is defined once, as tokens in `src/app/globals.css`, and consumed through components in `src/components/ui` and `src/components/charts`. Feature code uses neither raw colours nor ad-hoc spacing.

## Identity

Deep navy surfaces, one indigo brand colour with violet reserved for a single gradient accent, and colour otherwise spent only on status. Dark is the default theme; light is a first-class alternative, selected per browser.

## Colour

Authored in OKLCH on one hue (268°) so neutral steps are perceptually even.

| Role | Tokens | Use |
|---|---|---|
| Surfaces | `bg`, `surface`, `surface-2`, `surface-3`, `overlay` | page → card → raised → popover |
| Lines | `border`, `border-strong` | hairlines; controls |
| Text | `text`, `text-2`, `muted`, `faint` | primary → placeholder |
| Brand | `brand`, `brand-hover`, `brand-text`, `brand-soft` | primary actions, links, selection |
| Status | `ok`, `warn`, `danger`, `info`, `neutral`, each with `-fg` and `-soft` | state only |

Measured contrast against the card surface (WCAG ratio): primary text 16:1 dark / 17.7:1 light; secondary 9.4 / 9.3; muted 5.4 / 5.3; white on brand 5.0 / 6.6. `faint` (3:1) is for placeholders and decoration only.

**Status is never colour alone.** Every state has an icon and a word (`src/components/ui/status.tsx`).

## Typography

| Family | Use |
|---|---|
| Inter (variable) | Interface and body |
| Instrument Sans (variable) | Headings and large figures |
| JetBrains Mono (variable) | URLs, identifiers, code |

All three are self-hosted from `@fontsource` packages: no third-party request at build or run time.

Scale: 11, 12, 13, 14 (base), 16, then Tailwind's larger steps. 13px is the workhorse for dense UI. Tabular figures are used where numbers align in columns, proportional figures for large standalone values.

## Space, shape, elevation

- Spacing follows Tailwind's 4px scale; cards pad 20px; page gutters are 16 / 24 / 32px by breakpoint; content is capped at 1400px.
- Radii: 6px (controls), 8px, 12px (cards), 16px (hero surfaces).
- Elevation is mostly borders. Shadows (`sm`, `md`, `lg`) are reserved for things that float.
- Control heights: 28, 32 (default), 40px.

## Motion

Three keyframe families (fade, pop, slide) at 160–240ms on one easing curve. Motion marks a state change and nothing else. `prefers-reduced-motion` disables all of it.

## Breakpoints

Designed at 1440, 1024, 768, and 390px. Below 1024px the sidebar becomes a drawer. Tables drop their least important columns step by step and scroll inside their own container; nothing overflows the page.

## Components

Built on Radix primitives in the shadcn/ui style (source in the repository, styled with tokens): button, input, textarea, select, checkbox, switch, field, card, badge, dialog, sheet, confirm dialog, dropdown menu, popover, tooltip, tabs, segmented control, table, pagination, skeleton, toast, command palette, avatar, kbd, empty / error / callout states, page header.

Every data view implements loading (skeleton), empty, filtered-empty, error with retry, and refreshing (previous data held, dimmed).

## Accessibility

Semantic landmarks and headings; a skip link; visible focus rings on every interactive element; labels wired to controls with `aria-describedby` for hints and errors; `role="alert"` for errors and `aria-live` for async results; dialogs trap and restore focus; destructive actions require confirmation.

Keyboard: `⌘K` / `Ctrl+K` or `/` opens the command palette; `g` then `d`, `m`, `i`, `a`, `s` navigates.

## Charts

Charts follow a fixed set of rules:

- **Form before colour.** Single values are stat tiles, not one-bar charts. Parts of a whole are a segmented bar or ranked bars, not a donut.
- **One axis per chart.** Two measures of different scale get two charts.
- **Categorical colours in a fixed order**, never cycled: violet, orange, aqua, yellow, magenta, green, blue, red. The order was chosen by enumerating orderings and keeping those that pass colour-vision-deficiency separation (ΔE ≥ 8 under simulated protanopia and deuteranopia) and a normal-vision floor (ΔE ≥ 15) on both themes' surfaces. In the light theme three of the hues fall below 3:1 against white, so every chart also offers its data as a table.
- **Status colours are reserved for status** and never used as "series 4".
- **Sequential data uses one hue**, stepped by magnitude, with a scale legend.
- Lines are 2px; area fills are a 10% wash; bars are at most 24px wide with a rounded data end; gridlines are solid hairlines.
- A legend appears for two or more series; text is never in the series colour.
- Line and area charts have a crosshair tooltip listing every series; values lead, labels follow.
- **Every chart has a table view**, toggled from the card header.
- While refetching, the previous render stays on screen, dimmed.
