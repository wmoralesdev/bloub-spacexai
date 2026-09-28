# bloub

An SVG recreation of the x.ai bot avatar: **one filled black shape** that morphs
between 14 states, **two white shapes** for the eyes that morph independently, on
a plain background. The core avatar engine has no animation library; animated
speaker cards use Hyperframes and GSAP.

![The avatar going through idle, wink, orbit and burst](docs/demo.gif)

## Running it

Use Node.js 24 or newer and pnpm. Animated speaker downloads also need a local
Chrome/Chromium installation and FFmpeg with `ffmpeg` and `ffprobe` available.
The render service detects standard Chrome/Chromium install locations.
CMYK PDF downloads for bot cards and sticker sheets also need Ghostscript.
On macOS, install it with `brew install ghostscript`; the same local
Chrome/Chromium installation handles the PDF rendering.

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5190. This starts Vite on port 5190 and the local
render service on 5191, with API requests proxied through Vite. If Vite is
already running, start only the missing service with `node server/index.ts --dev`.
`pnpm-workspace.yaml` allows the esbuild install script and intentionally disables
Puppeteer's browser download; use the installed browser instead.

```bash
pnpm test     # vitest
pnpm build    # vue-tsc --noEmit && vite build
pnpm start    # compiled app and render API together at http://localhost:5190
```

`pnpm build && pnpm start` runs the compiled app locally from one origin;
`pnpm preview` alone does not start the render API. This is not a public deployment.
For nonstandard binary locations, set `HYPERFRAMES_BROWSER_PATH`,
`HYPERFRAMES_FFMPEG_PATH`, or `HYPERFRAMES_FFPROBE_PATH` to the executable paths.
Use `BLOUB_GHOSTSCRIPT_PATH` for a nonstandard Ghostscript executable.
See [speaker export details](docs/export.md#speaker-artwork) for service settings.

Vue 3, Vite, TypeScript, Tailwind 4. No ESLint and no Prettier: `vue-tsc` is the
only gate, so run `pnpm build` before you call something done.

## What's in it

The rail on the left switches between views. **Customise** offers 8 body
shapes, 12 colours and 16 rest expressions, kept between visits. **Stills**
collects frozen portraits of those triples and exports them as a zip of PNGs.
**Speakers** creates event artwork from a cutout portrait, editable text and a
group of bots, with 4:3, 1:1 and 9:16 layouts and PNG/JPEG or animated MP4/GIF downloads.
**Animations** is a small editor: arrange states into a timeline, set how long
each is held, save the result. **Settings** holds the language (French, English
or Chinese) and the credits.

Anything on screen can be exported: the avatar as SVG, PNG or an animated GIF,
a collection of stills as a zip of PNGs, and a whole timeline as GIF or MP4. The
still formats need no library at all, and the video encoder is only fetched the
first time you ask for one.

**Bot cards** also export a CMYK PDF of the selected face, or a ZIP with a separate
PDF for each face of every saved card. Cards default to 10 × 10 cm, adjustable
from 1 to 30 cm. **Stills** can arrange selected bots and an uploaded SVG logo on
a sticker sheet, with either RGB SVG artwork or a CMYK PDF plus matching SVG cut
lines. CMYK PDFs use Ghostscript’s SWOP profile with an embedded output intent;
the on-screen previews remain RGB. See [print export details](docs/export.md#cmyk-print-export).

### Speaker artwork

Open **Speakers** to choose a saved speaker or create a variant. Walter Morales,
Daniela López, Fernando Borea, Saul Calderon and Leonel Guerrero are included with prepared cutout portraits
and the Grok Bot San Salvador Meetup example. Replace the portrait with a
transparent PNG or WebP, edit the talk title, event and speaker details, then
adjust the framing and diagonal fade.
Manual title line breaks are preserved in both preview and exported images.
The talk title gets a dedicated headline above the speaker. Date and time sit
below the event in a white header line whose size stays independent of the talk
title; venue and URL remain in the footer. Leaving the title blank keeps the
original portrait layout.
Story portraits sit higher and use a taller frame to reduce the space below the
speaker details. **All speakers (ZIP)** exports every saved variant in 4:3, 1:1
and 9:16 using the selected PNG, JPEG, MP4 or GIF format, then adds the collective
**Speakers & talks** artwork in the same three sizes. Files render sequentially
with progress and cancellation; editing the library does not change an export
already in progress.

Switch to **Speakers & talks** to preview and download the collective artwork on
its own. It uses the current portraits, names and talk titles from the saved
speaker cards, in their library order, with event details from the first card.
It does not add session times. Speakers without a title keep their name, and the
editor links back to each individual card to fill in or change its details.

Each variant saves its text, composition, photo and export format automatically
in this browser's localStorage after a 600 ms pause in editing. Variants survive
section changes and reloads; duplicate one to reuse its details for another
speaker. The save status shows whether changes were stored and offers a retry
if browser storage is unavailable or full. Uploaded portraits are optimized to
transparent WebP with a maximum dimension of 1200 px for local storage. The
original files stay unchanged. Clearing site data removes saved variants.

Exports are 2400 × 1800 (4:3), 2000 × 2000 (1:1), or 1080 × 1920 (9:16,
portrait format for Instagram Stories).
Both PNG and JPEG have an opaque black background; JPEG uses 95% quality.
Static previews and downloads use the same Canvas 2D renderer.

Choose **MP4** or **GIF** for a silent, seamless 6-second animation. The five bots
keep their neutral expression, shape, size and colour, with gentle gaze shifts,
blinks and very subtle floating. Each bot has its own timing; movements can
overlap naturally. Photo and text remain still. Hyperframes loads when an animated
format is selected, with a looping preview and pause button. The preview pauses
while hidden and starts paused when reduced motion is preferred.

MP4 retains the native dimensions at 30 fps; enable repeat in the video player
for continuous playback. GIF repeats infinitely at 15 fps, with a maximum
dimension of 960 px. Animated exports send a frozen copy of the card's layers
and bot geometry to the local Node service; later edits do not change the render.
The editor shows progress, cancellation and retry. One render runs at a time,
and completed downloads remain available for 15 minutes. No remote image service
is required.

Daniela and Fernando use the approved AI-edited transparent portraits. Saved
variants keep their existing photo references and editable text.
Prepare future portraits with a background-removal tool such as macOS Preview's
**Remove Background** command, then save a copy as PNG. Keep the original photo unchanged.

The active view is part of the URL, so it can be shared or restored on reload:

- `?tab=speakers`: opens the speaker editor directly, skipping the arrival animation.
- Other tab values are `personnaliser`, `figes`, `bot-cards`, `animations`, and `reglages`.
- An absent, empty, or unknown `tab` opens Customise. Selecting Customise removes
  the parameter; `?tab=personnaliser` is also accepted.
- `#planche`: the 14 states side by side, frozen. Quick visual check.
- `?tab=animations#etat=orbit&stop`: opens one animation state directly, playback paused.

Switching tabs adds a browser history entry; Back and Forward restore the selected
view. The tab selects the view independently of any retained state fragment, so
`?tab=speakers#etat=orbit&stop` opens Speakers and `#etat=orbit&stop` alone opens
Customise. Other search parameters are preserved.

![The 14 states, frozen side by side](docs/states.png)

## Why the numbers look arbitrary

They're measured, not chosen. The reference video was cut at 10 fps and each
state measured off the frames: silhouettes by sub-pixel ray casting, eyes by
capsule fitting, colours and stroke widths by direct sampling.

So the constants in the code are **measurements**, and rounding them to friendlier
values breaks the resemblance, which is the only thing this project is trying to
get right. A few are counter-intuitive enough to be worth knowing before you
correct anything:

| What you'd assume | What the video shows |
|---|---|
| The eyes lean `//` | They lean `\\`, around 26° off vertical |
| The body is a squircle | It's a perfect circle, radial deviation under 0.7% |
| Transitions are springs | Exponential ease-outs; the body never overshoots |
| The comet crosses the screen | The dot stays put, the trail orbits it |
| The avatar floats at rest | It doesn't. The life is gaze drift and blinking |

[docs/measurements.md](docs/measurements.md) has the rest, including how to
regenerate the extracted profiles.

## How it's put together

`src/bot/` is framework-free and clock-free: `engine.sample(t)` is a pure
function of time. Pausing, resuming, jumping to an arbitrary date and running
tests all produce the same image, which is what makes the frozen state board and
the DOM-less test suite possible.

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | The engine, radial-profile morphing, eyes as mask holes |
| [docs/measurements.md](docs/measurements.md) | What was measured, and regenerating `profiles.ts` |
| [docs/intro.md](docs/intro.md) | The arrival sequence, and why it only plays one state |
| [docs/interface.md](docs/interface.md) | Layout, the three-column scene, CSS traps |
| [docs/export.md](docs/export.md) | Exporting to SVG, CMYK PDF, PNG, GIF and MP4 |
| [docs/i18n.md](docs/i18n.md) | The hand-rolled translation layer |

## Using the component

```vue
<BloubBot v-model:block="block" v-model:state="state" v-model:playing="playing" />
<BloubBot state="orbit" :size="120" :frozen-at="1.2" />
```

`block` is the playback cursor: a montage can play the same state twice, so the
index is what identifies where you are; `state` follows it as an output. Pass
`frozenAt` and the component renders one exact frame with no animation loop, which
is how the thumbnails and the state board are drawn.

Props: `size`, `shape`, `color`, `expression`, `paper`, `frozenAt`, `cycle`,
`follow`, `gaze`. Models: `block`, `state`, `playing`, `elapsed`. See
[BloubBot.vue](src/components/BloubBot.vue) for the details.

## Changes

[CHANGELOG.md](CHANGELOG.md), one entry per release — which is how you tell whether the
copy you have carries a given fix.

## License

MIT. See [LICENSE](LICENSE).

Not affiliated with, endorsed by or connected to x.ai. It recreates the visual
behaviour of their bot avatar as an exercise; "Grok" and "x.ai" belong to their
owners. The MIT licence covers the code in this repository, not the design it
imitates.
