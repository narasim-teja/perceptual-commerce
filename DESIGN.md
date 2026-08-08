# Design

<!-- impeccable:design-schema 1 -->

Governs `frontend/`. Written from the built surface, not from intention. Product truth lives in
[PRODUCT.md](PRODUCT.md); the technical spine lives in `docs/02-technical.md`.

## The world

**Bitmap specimen.** A specimen sheet for a machine's sight, printed on newsprint. The subject is a
camera frame reduced, in public, until it is a hundred numbers a contract can rule on, so the
surface treats low resolution as the aesthetic rather than as something to hide behind smoothing.

It exists to refuse the arrangement this category always ships: near-black ground, one neon accent,
glassy rounded cards in a two-column grid, a pulsing live pill, a dotted timeline. That was the
incumbent dashboard, and it is what every other table will have.

The direction contract is an HTML comment at the top of `<body>` in `app/layout.tsx`. It survives
the production build; grep the built output for `2eab50ae`.

## Stock and ink

Every surface is either paper or ink. There is one accent and it is a field, never a text colour.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f5f3ec` | the sheet |
| `--paper-2` | `#ece9df` | panel heads, colophon, the second neutral layer |
| `--paper-3` | `#ded9cb` | dashed leaders, empty meter cells, the dot lattice |
| `--ink` | `#0a0a0a` | rules, borders, type, the masthead, permit fields |
| `--ink-2` | `#2e2c29` | secondary text on paper, 13.9:1 |
| `--ink-3` | `#6b6659` | labels and captions on paper, 5.2:1 |
| `--ink-inv` | `#f5f3ec` | text reversed out of ink, 17.8:1 |
| `--ink-inv-2` | `#a8a296` | secondary text on ink, 7.8:1 |
| `--ink-inv-3` | `#6f6a5e` | rules and disabled state on ink. Never body text, 3.4:1 |
| `--signal` | `#ff5a3c` | the one accent |
| `--signal-ink` | `#b8341a` | the rare accent-toned word on paper, 5.3:1 |

**The accent rule, and why it is absolute.** `#ff5a3c` on newsprint is 2.8:1 and fails as text.
Black on `#ff5a3c` is 6.4:1 and passes. So the accent only ever appears as a filled block with ink
set into it. Any accent-toned word on paper uses `--signal-ink`.

**Allow and deny are materials, not colours.** A permit is a solid ink field; a refusal is the
accent under a 45° hatch (`.field-permit`, `.field-refuse`). Solid against hatched survives a
washed-out projector, a greyscale capture, and a colourblind reader. The colour is a second signal,
never the only one. This is a hard requirement from the use scene, not a preference.

## Type

| Role | Face | Notes |
|---|---|---|
| Display, labels, marks | **Silkscreen** | A bitmap face. Locked to integer steps: `.bit-8/12/16/24/32/48`. Never set at an arbitrary size. |
| Text | **Archivo** | Body, notes, descriptions. |
| Data | **Azeret Mono** | Hashes, ids, amounts, timestamps. Earned: telling `0` from `O` in a tx hash is the job, not a costume. |

`tabular-nums slashed-zero` is on at the body. Do not reference `--font-bitmap` / `--font-sans` /
`--font-mono` outside a Tailwind utility: `@theme inline` substitutes them into utilities rather
than emitting custom properties, so hand-written CSS must name `--font-silkscreen`,
`--font-archivo`, `--font-azeret` directly. Getting this wrong falls back to Courier silently.

## Geometry

- **No border radius anywhere.** Corners are square. The pixel-step cut (`.step`, 3px) is for solid
  ink fields only; it clips a border's corners, so it never goes on a bordered element.
- Panel and control borders are **2px ink**. Row separators are 1px dashed `--paper-3`.
- Spacing runs on whole pixels, written as explicit values (`py-[10px]`), because the design sits on
  a pixel grid and `py-2.5` obscures that intent.
- `.lattice` is a 6px dot grid used as the well behind imaging surfaces.

## Components

All of them live in `components/kit.tsx`. There is no component library, and a stock rounded button
inside this world would give the whole sheet away.

- **Panel** — ruled block, `--paper-2` head with a `.bit-16` caption and an optional status chip.
- **Button** — flat at rest; hover lifts it onto a 4px hard ink block; press puts it back down. One
  physical idea, three states. Disabled clears both the hatch and the shadow, so an unavailable
  danger control does not read as an active alarm. Three sizes, and `sm` is not a free choice: it
  carries the Segmented's exact metrics, so a control standing in a panel head leaves that head the
  height it already was. The three columns share one top rule, and a head that grows by ten pixels
  breaks the alignment the whole console is read against.
- **Segmented** — selection inverts to solid ink. No accent: selection is not an alarm.
- **Datum** — `.label` left, dashed leader, `.datum` value right.
- **Meter** — run of cells filled to value, with a full-height tick standing at the threshold.
  Readable with no colour at all.
- **Stamp** — the ruling, struck. `permit` / `refuse` / `idle`.

## Motion

One authored moment: the masthead strikes whichever of the three planes last emitted an event, so
the strike travels perception → policy → settlement during a run. It is driven by real pipeline
events, which makes it a readout rather than decoration.

Everything else is a state transition at 100–150ms. No page-load choreography; this is a console and
it loads into a task. `prefers-reduced-motion` collapses all of it.

## Imaging

`lib/screen.ts` is a real printing screen, not a CSS filter. Frames are reduced to a luminance grid
and drawn as duotone coverage, variable square dot, or one-bit ordered Bayer dither.

The halftone and matrix screens run a smoothstep tone curve before drawing. Without it every
midtone lands at half coverage, half coverage on a square-dot screen is a checkerboard, and a whole
frame of midtones reads as noise instead of as a subject. This is the single change that made the
hero legible; do not remove it.

**The detector sits beside the chain, not at the end of it.** A model can be swapped in to turn the
watched region into a count, and the reduction stays on screen when it is, but the reduction is not
what the model is handed. The model reads a crop of the watched region at source resolution, because
a detector given a 12×9 bitmap would find nothing. What the chain does while a model runs is produce
the frame hash that travels with the intent as evidence, and gate inference once a reference exists.

The caption says exactly that: `Xenova/yolos-tiny reads the region, not this`. It used to say `then
Xenova/yolos-tiny`, which read like an arrow from the strip into the model, and that is a mechanism
the code does not implement. Naming the wrong mechanism does not get an exemption for being
flattering, and a caption is where a judge checks. Detections are
drawn over the hero as hollow accent boxes with the score set into a filled tab. Hollow, because a
solid box would hide the pixels the count is a claim about.

**The chain strip is the frame's control, not a caption under one.** Pressing a rung fills the hero
with it, and the pressed thumbnail inverts to solid ink like every other selection on the sheet.
There used to be a second picker in the panel head printing the same four words at the strip, so the
surface asked which rung you wanted twice and answered in two places; that is what made the panel
read as five views of one frame. One question, asked where the answer is visible. The decision grid
became legible at poster scale as a side effect, which is the rung most worth looking at.

There is one control over the source and it is honest about what off means: no controller exists,
the camera tracks are stopped, the device indicator goes out, and the readout reverts to reading
nothing rather than holding the last number it measured. A stopped source outranks every other
blocking state in the frame, because none of them are true while nothing is running.

Every claim the detector cannot make is written as absence rather than as a plausible number: the
screen detector reports "not counted", not an implied stock figure. A model that is downloading, has
failed, or is running on a slower backend says so in words, with the megabytes and the backend
named. This is the same rule as the allow/deny materials: the interface states the mechanism and
names the limit, and never renders a confident value it did not measure.

## Composition

Three columns on `lg` and up, in a fixed-height console that does not scroll the page: **the sight**
(1.4fr), **the gate** (0.9fr), **the record** (1.05fr). Below `lg` they stack and the page scrolls.
The frame takes an explicit `aspect-[4/3]` when stacked, because a `flex-1` canvas in an
unconstrained column collapses to zero height.

The gate's two destructive controls are anchored to the base of their column with `mt-auto`, so they
sit in the same place whatever the panel above happens to be saying.

The sight follows the same rule, in the form its own content forced. The frame holds `lg:h-[40%]`,
everything explanatory below it scrolls as one block, and the control row is pinned outside that
scroll against the base of the panel. The operator drives this with one hand while talking, so the
primary action must never move; adding the detector section to an already-full column is what made
that explicit rather than incidental.

Inside that scroll the order is the reading order: the chain strip sits against the frame because it
is the frame's picker, then the number, then the mechanism that produced it. The room is reading the
number, and how it was reached is the answer to the lean-in question, which comes second.

One more accent rule, learned from the built surface. The `n found` mark over the frame is ink until
the reading is one that would fire, and only then the accent. A count of nothing printed in the
accent read as a fault in the panel rather than as a shelf that needs restocking, which is the
opposite of what the mark is for. Before a model has answered at all, the mark says so instead of
printing a zero it has not measured.

## The scene this was designed for

A dim room, a projector, three minutes, one operator driving and a judge who never touches it.
That scene picked the light ground (a projector crushes near-blacks into one mud tone and loses
hairlines), the material-not-colour state vocabulary, and the size of the marks in the record.

## Copy

- **No em dashes.** Binding, from the user. Use commas, colons, parentheses or a full stop.
- Lowercase for `.bit` labels and control text; sentence case for prose.
- State the mechanism, name the limit, refuse to overclaim. The surface says "mint authority" and
  never implies the contract intercepts a live card authorization.
- A refusal is written as the system working, never as an error.
