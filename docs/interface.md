# Interface

## The icons come from a library, not from a pencil

The paths in `SideRail.vue` and `Timeline.vue` are copied verbatim from Iconify
packages (Solar, plus Remix for the palette). No dependency is installed, so
`package.json` doesn't mention it, and the "everything is measured" rule does
**not** apply here.

To add or change one, take the `<symbol>` body from `@iconify-json/<package>`.
Don't redraw by hand (tried, rejected) and don't "re-centre" their coordinates.

## Truncating is `tronque`, not `truncate`

The in-house utility (`styles.css`) cuts at the word and butts the ellipsis against
the text; `truncate` cuts mid-word and leaves a space before the dots when the cut
falls between two words.

## The Tailwind reset breaks top-layer elements

It sets `margin: 0` everywhere, and it's the auto margin that centres a `<dialog>`
as a modal: without `m-auto` the box sticks to the top left. Same family of trap for
a `popover`, whose default styles set `inset: 0`: any positioning must reset the
sides it doesn't use to `auto`, otherwise `top: 0` wins.

Third one, and it is not about the reset: **don't nest a modal `<dialog>` under an
ancestor that can carry `inert`.** Being promoted to the top layer does not exempt it:
`inert` applies to the whole subtree, so the box renders and cannot be used. `GifDialog`
is opened by the export bar but sits *outside* it for exactly this reason, since the bar
goes `inert` while it is hidden.

## The scene is a three-column grid, and that's what moves the avatar

`[left panel] [avatar] [right panel]`: only one panel column has a width at a time,
and it's the **interpolation of the tracks** that slides the avatar. Written in
`styles.css` rather than in utilities because both states need to be literal values
for the transition to have something to interpolate. Don't try `order` or
`flex-direction`, they don't animate.

**Unmounting a panel does not remove its track**: the grid keeps its 20rem and the
avatar stays centred 180 px too far left. Hence `.scene--seule`, which cancels both
columns. The arrival and the preview both use it, so don't restrict it to one of
them.

**A zero-width column still contributes its `column-gap`.** Outside the settings the
left track is `0`, but the gutter after it is not, so the avatar column starts at
**4.5rem** (2rem of scene margin + 2.5rem of gutter), not at 2rem. That is why
anything pinned to the window and meant to line up with the avatar (the montage bar,
the export bar) uses `left: 4.5rem` as the counterpart of `right: 24.5rem`
(20 + 2.5 + 2). Aiming at the scene's padding instead leaves it 20 px off centre,
which is exactly enough to see under the ball.

## The side rail floats and reserves nothing

It is `fixed` and vertically centred on the window. The scene deliberately keeps **no**
padding for it: reserving a column's worth of space pushed the avatar right, and the
rail is supposed to sit over the page, not beside it. The only content that reaches far
enough left to pass under it is the settings panel, so that panel carries its own
`lg:pl-14`. Don't move the clearance back onto the scene.

## The avatar's `transition` is outside the width query, its positions are inside

Bringing them together looks tidier and breaks two things: the arrival's fade-in
applies at every size, and, more importantly, a `transition` redeclared in the
block below **evicts opacity**. A property absent from the list stops transitioning
altogether, so the ball would appear all at once.

## Horizontal clipping is on `#app`, not on `body`

The body's `overflow` is **propagated to the viewport** when the root is `visible`,
so putting it there clips nothing. And `clip` rather than `hidden`, on the x axis
only: `hidden` would make it a scroll container, which would force `overflow-y` to
follow and cut off the bottom of the customiser in a short window.

## On a large screen the page doesn't scroll, the panels do

`#app` clips both axes past 64rem and the panels take `overflow-y: auto`. The trap
that cost an iteration: an **automatic** grid track takes its content's height and
ignores the container's ceiling, so the panel got clipped without having anything to
scroll. Hence `grid-template-rows: minmax(0, 1fr)` on the scene. that's what makes
the height definite and arms `overflow-y`.

## Room for the timeline is reserved in the Animations view only

Reserved in every view (a `padding-bottom` on the scene), it took 236 px off the
right-hand panel in favour of emptiness that nothing filled: the customiser scrolled
under a third of a blank screen.

What that reservation *also* held (the avatar and the settings panel, which must
not re-centre when you switch tabs) is carried by those two columns themselves, in
the form of the same band height (`100dvh - 3rem - var(--timeline)`). That's why the
settings panel is `self-start` plus internal centring rather than `self-center`:
centring on the column would drop it a hundred pixels the moment the column ran to
the bottom.

## The big footer word is `absolute`, not `fixed`

`#app` is exactly the window's height, so the bottom is the same, but a fixed
element is *out* of the document and doesn't follow the rubber-band when you try to
scroll a page that doesn't scroll. As `absolute` it goes along with the gesture.

Its size is computed on the space actually available
(`calc((100vw - 7rem) / 3.05)`, 3.05 being the measured width of the word in ems):
in `vw` alone its last character ended up off screen.

## Six rail views with shareable URLs

The rail has Customise, Stills (`figes`), Bot cards, Speakers, Animations, and Settings. Stills is a
collection of frozen idle portraits (shape × expression × colour); it never writes
the hash. The centre is the grid of added stills, the right panel is the same
customiser plus Add.

Stills also has a separate checkbox on each portrait for sticker-sheet selection.
Checking it does not open the portrait for editing, and editing a portrait does not
change its sheet selection. Select all, Clear selection and a selected count sit
beside Create sheet, which is enabled when a portrait is checked or a branding
SVG is uploaded. Bot selection starts empty and is not saved. The optional branding
upload adds one more sticker, with a cut line following the logo silhouette. SVGs
must be self-contained, at most 256 KB, with text converted to outlines. The logo
is saved locally and can be replaced or removed independently of the bots.

The sheet dialog shows the active A4, Letter, Half Letter, ¼ Letter or Custom preset.
Half Letter is 215.9 × 139.7 mm and ¼ Letter is 139.7 × 107.95 mm in landscape.
Custom enables
dimension editing in centimetres; any preset can change orientation. Sheet colour
affects artwork and overlay, while cutting remains contours only. White border,
spacing and margins use millimetres. Artwork, cutting and overlay previews share
one physical layout.
Defaults are A4 landscape (297 × 210 mm), a 2 mm white border, 4 mm spacing and
10 mm margins. Auto-fit is enabled initially: it finds the largest common sticker
size that fits the selection, balances row counts and centres each row and the
whole group. Turning it off restores the editable manual size (initially 40 mm,
including the border, for a capacity of 24). Manual overflow or invalid geometry
blocks download with an explanation. The options persist locally, and no mode adds
extra pages. The export format selects RGB SVG artwork or CMYK PDF artwork. The
resulting ZIP contains `arte.svg` or `arte-cmyk.pdf` plus a matching `troquel.svg`
at the same physical sheet size, without cutter-specific registration marks.
CMYK uses the SWOP profile through the local render service; the on-screen
preview remains RGB. Existing still downloads remain available independently.

Branding has its own size and centre position, in centimetres measured from the
sheet’s top-left corner. Its size is the longest finished side, including the white
border, and preserves the logo’s proportions. Drag the logo in the preview with a
mouse or touch, or focus it and use the arrow keys; hold Shift for larger steps.
The numeric fields provide precise placement. When a larger logo needs more room,
the other stickers in its row move left while retaining their size and spacing;
other rows stay in place. Reset logo restores automatic size and placement. Logo
adjustments are saved locally. Its white border and cut line retain their physical
dimensions and match across preview and exports. A logo extending beyond the sheet
margins, or leaving too little room for the stickers beside it, blocks download
until its size or position is corrected.

The `tab` search parameter selects the view: `personnaliser`, `figes`, `bot-cards`,
`speakers`, `animations`, or `reglages`. A direct tab link skips the arrival animation
and opens its editor immediately. Reload, browser Back and browser Forward restore
the tab; selecting another tab adds one history entry and preserves other search
parameters. An absent, empty, or unknown value selects Customise. Selecting Customise
removes `tab` from the URL; the explicit `?tab=personnaliser` value is also accepted.
Editors still retain their drafts when switching views.

Bot cards has its own editor, loaded on first visit and kept mounted while hidden.
The collection starts empty; cards are created on demand, with a name, handle,
description, bot link, optional event name and their own bot shape, expression and colour. Front and
Back controls select the side shown in the static square SVG preview and used
by the PNG, SVG and CMYK PDF downloads. The front fills the square with six colourful bots on
black, with a customisable event name of up to 80 characters. The event name field
accepts Enter for manual line breaks, preserved in the artwork. The card's customised
bot occupies the lower-right position in the collage. The back places the QR code alongside
the bot, name, handle and description on white. A valid HTTP(S) link is required to
export the back with its QR code; the front can be exported without a link.
CMYK PDF has a square physical card size, initially 10 × 10 cm and editable from
1 to 30 cm. It uses the SWOP profile, while the preview remains RGB.
The collection's PNG, SVG and CMYK PDF ZIP buttons download both sides of all saved
cards as separate files and show progress. Missing names or links take the user to the first card that needs
attention before generating any files. Individual and collection exports cannot
run simultaneously.
Older saved cards load with an empty event name and an empty link if none was saved.
The card collection is saved locally
after a 400 ms debounce and on `pagehide`; save failures leave
the draft available and offer a retry. Cards can be selected, duplicated and
deleted with confirmation. This view hides the animated scene and never writes
the player's URL fragment.

Speakers uses a separate editor layout, not the avatar scene's three-column
grid. It loads on first visit and stays mounted while hidden. Saved speaker
variants preserve text, composition, photo and export format in localStorage,
with a 600 ms debounce; the selected variant is restored on reload. The editor
does not write the player's URL fragment. The initial variants include Walter
Morales, Daniela López, Fernando Borea, Saul Calderon and Leonel Guerrero with bundled cutout portraits. Users
can create, select, duplicate and delete variants, or choose a different bundled
photo. New bundled speakers are added to existing libraries without replacing
saved edits, changing the selection or restoring deleted variants. Deleting a
variant requires confirmation. A save status reports pending
changes, successful local saves or storage errors and allows retrying a save.
The artwork is a canvas beside a labelled form on desktop, and above it on
small screens. The 4:3, 1:1 and portrait 9:16 formats recompose the design rather
than stretch it. Photo framing has keyboard-accessible range controls; no drag-only editing
is required. Only transparent PNG/WebP portraits are intended for this editor;
background removal happens beforehand. Daniela and Fernando use the approved
AI-edited transparent portraits; their photo IDs stay stable for saved variants. Uploaded photos
are optimized to transparent WebP with a maximum dimension of 1200 px before
being saved locally. The source files remain unchanged. Storage failures leave
the current draft available in the tab; clearing site data removes saved variants.

The **Individual cards / Speakers & talks** switch opens a collective artwork
with the saved portraits, names and talk titles, without individual session
times. Its aspect starts at 1:1 and can also use 4:3 or 9:16. Each speaker links
back to their editable card; event details come from the first saved card.
Landscape and square artwork place a compact two-column agenda above a large,
overlapping row of bust portraits, with a gentle progression in size. The five
bots form a spaced group in the upper-right corner, with four distinct extra bots
extending left and down to form a short frame. They look down and left toward
the content. Their silhouettes stay upright, and space is reserved from the
header and agenda at every bot size. Stories
alternate portraits and talk text in one close row per speaker, with bots along the edges.
Tall source photos are framed from the top down, preserving heads and cropping
the lower body. The same composition serves static and animated exports.
The collective preview and download use the same four file formats as individual
cards. The ZIP action appends its three sizes after all individual cards, using
the selected file format and the collection captured at the start of export.

The format selector offers PNG, JPEG, MP4 and GIF, saved independently per variant.
The dimensions beside the aspect controls reflect the chosen format: static
images and MP4 use native dimensions; GIF caps the longer side at 960 px.
Selecting MP4/GIF loads a Hyperframes preview of the same 6-second, silent
composition used for export. The bots retain their neutral expression,
shape, size and colour, with gentle gaze shifts, blinks and very subtle floating.
Each bot has its own timing, and movements can overlap. Portrait and text stay fixed.
A pause/play control is available, and playback pauses when Speakers, its preview,
or the browser tab is hidden.
Reduced-motion preferences start the preview paused.

Animated downloads use the local render service. Progress and Cancel appear
while rendering; duplicate submissions are disabled. The form remains editable,
but an in-flight export retains the captured card and filename. Failure shows
an error and Retry export; cancellation returns the editor to a downloadable
state. GIF files loop infinitely; MP4 guidance explains that repetition is a
video-player setting. PNG/JPEG retain their static preview and browser export.

## Search parameters select the view; the fragment describes playback

The `tab` parameter selects the view independently of a retained `#etat=` fragment.
For example, `?tab=speakers#etat=orbit&stop` opens Speakers. An absent, empty, or
invalid tab always selects Customise, including on a URL with `#etat=`. To link
directly to a playback state, use `?tab=animations#etat=orbit&stop`.
`#planche` continues to display the frozen state gallery; its return link preserves
the tab parameter.

`#etat=` is only written from the Animations view. It follows the current state
and playback (`&stop` for paused) using `history.replaceState`, which retains the
search parameters and does not add a history entry for each state. Tab selection
uses `history.pushState`; incoming Back/Forward navigation restores the view
without writing another entry.

Using `replaceState` also avoids firing a `hashchange` for our own playback updates.
That matters when a montage contains the same state twice: resolving an incoming
state fragment with `locate()` selects its first occurrence, so interpreting our own
update as navigation would jump back from the second occurrence. Genuine incoming
fragment changes and history navigation are still read normally.

## Every editing gesture has a keyboard route

Drag-and-drop had no equivalent, so a block could be added, removed and resized — the
resize handle already took arrow keys — but never **reordered**, and precise seeking existed
only on the ruler, pointer-only. It was the one gesture in the editor that was unreachable.

`Alt` + left/right moves the focused card; bare arrows move the playhead by `STEP`. `Alt`
rather than bare arrows for the move, because a card is a button inside a list and arrows
there are expected to navigate. **The focus follows the card being moved** — otherwise the
next press pushes a different one — which means waiting a tick, since the list is rebuilt
and the destination button does not exist yet.
