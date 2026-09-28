/** A finite composition; the player and GIF encoder own repetition. */
export const SPEAKER_ANIMATION_DURATION = 6
/** Floating remains almost imperceptible, even at the largest bot size. */
export const SPEAKER_ANIMATION_FLOAT_RATIO = 0.003

/** Individual deterministic rhythms, all at rest on both sides of the loop seam. */
const NEUTRAL_MOTIONS = [
  { gaze: [[-1.2, 0.4], [0.8, -0.35]], gazeAt: [0.32, 2.1, 4.6], gazeDuration: [0.8, 0.9, 0.78], blinks: [1.18, 4.23], float: [-1, 0.3, 1.1, 0.4, 1.2] },
  { gaze: [[1.4, -0.25], [-0.6, 0.35]], gazeAt: [0.57, 2.62, 4.82], gazeDuration: [1, 0.75, 0.65], blinks: [2.03, 4.93], float: [0.8, 0.72, 1.3, 0.15, 1.05] },
  { gaze: [[0.7, 0.35], [-1.2, -0.15]], gazeAt: [1.02, 2.95, 4.4], gazeDuration: [0.7, 0.85, 0.85], blinks: [0.76, 3.69], float: [-0.65, 1.14, 0.95, 0.55, 1.15] },
  { gaze: [[-1.6, -0.4], [0.7, 0.2]], gazeAt: [0.75, 2.37, 4.7], gazeDuration: [0.9, 1, 0.72], blinks: [3.27, 1.92], float: [0.7, 0.46, 1.2, 0.35, 1.35] },
  { gaze: [[1, -0.35], [-0.75, 0.3]], gazeAt: [1.3, 3.1, 4.52], gazeDuration: [0.85, 0.7, 0.8], blinks: [4.06, 2.79], float: [-0.85, 1.56, 0.9, 0.25, 1.1] },
  { gaze: [[-0.9, -0.3], [0.65, 0.45]], gazeAt: [0.46, 2.42, 4.78], gazeDuration: [0.92, 0.76, 0.72], blinks: [1.53, 4.51], float: [0.6, 0.98, 1.1, 0.31, 1.27] },
  { gaze: [[1.15, 0.2], [-0.8, -0.4]], gazeAt: [0.91, 3.16, 4.68], gazeDuration: [0.74, 0.67, 0.84], blinks: [2.46, 5.13], float: [-0.72, 1.82, 0.86, 0.26, 1.22] },
  { gaze: [[-0.55, 0.5], [1.05, -0.2]], gazeAt: [0.68, 2.81, 4.39], gazeDuration: [0.88, 0.82, 0.93], blinks: [0.98, 3.96], float: [0.92, 0.61, 1.24, 0.28, 1.08] },
  { gaze: [[0.85, -0.45], [-1.05, 0.25]], gazeAt: [1.16, 2.68, 4.86], gazeDuration: [0.79, 0.95, 0.68], blinks: [1.72, 4.74], float: [-0.58, 1.37, 1.16, 0.46, 1.02] }
] as const

/** The lineup can add four accents, each with its own neutral motion track. */
export const SPEAKER_ANIMATION_MAX_BOTS = NEUTRAL_MOTIONS.length

export interface SpeakerAnimationEye {
  d: string
  matrix: string
  alpha: number
}

export interface SpeakerAnimationBot {
  /** Center, side length and rotation in the output image's coordinate system. */
  x: number
  y: number
  size: number
  angle: number
  color: string
  bodyPath: string
  eyes: SpeakerAnimationEye[]
  viewBox: string
}

/** A render request contains image/geometry data, never HTML or script. */
export interface SpeakerAnimationSnapshot {
  width: number
  height: number
  background: string
  foreground: string
  bots: SpeakerAnimationBot[]
}

function attribute(value: string | number) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]!)
}

function number(value: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid composition coordinates')
  return value
}

function eyeCenter(matrix: string): [number, number] {
  const values = /^matrix\(([^)]+)\)$/.exec(matrix)?.[1]?.trim().split(/[\s,]+/).map(Number)
  if (!values || values.length !== 6 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid eye matrix')
  }
  return [values[4]!, values[5]!]
}

function botMarkup(bot: SpeakerAnimationBot, index: number) {
  const [left, top, width, height] = bot.viewBox.trim().split(/\s+/).map(Number)
  if ([left, top, width, height].some((value) => value === undefined || !Number.isFinite(value))) {
    throw new Error('Invalid bot viewBox')
  }
  const mask = `speaker-mask-${index}`
  const eyes = bot.eyes.map((eye, eyeIndex) => {
    const [x, y] = eyeCenter(eye.matrix)
    return `<g data-blink="${eyeIndex}" data-center-x="${x}" data-center-y="${y}" transform="translate(${x} ${y}) scale(1 1) translate(${-x} ${-y})"><path data-eye="${eyeIndex}" d="${attribute(eye.d)}" transform="${attribute(eye.matrix)}" opacity="${number(eye.alpha)}" fill="#000"/></g>`
  }).join('')
  return `<g data-bot="${index}" transform="translate(${number(bot.x)} ${number(bot.y)})"><g data-float transform="translate(0 0)"><g data-rotation transform="rotate(${number(bot.angle)})"><svg x="${-number(bot.size) / 2}" y="${-bot.size / 2}" width="${bot.size}" height="${bot.size}" viewBox="${attribute(bot.viewBox)}" overflow="hidden"><defs><mask id="${mask}" maskUnits="userSpaceOnUse" x="${left}" y="${top}" width="${width}" height="${height}"><path data-body-mask d="${attribute(bot.bodyPath)}" fill="#fff"/><g data-gaze transform="translate(0 0)">${eyes}</g></mask></defs><path data-body d="${attribute(bot.bodyPath)}" fill="#000"/><g mask="url(#${mask})"><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${attribute(bot.color)}"/></g></svg></g></g></g>`
}

/** JSON is embedded as script data; HTML metacharacters must never terminate it. */
function scriptData(value: unknown) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/**
 * Shared verbatim by preview and Producer. GSAP is bundled locally into this HTML,
 * so decoding a snapshot never depends on a CDN or an open editor tab.
 */
export function createSpeakerComposition(
  snapshot: SpeakerAnimationSnapshot,
  gsapSource: string,
  runtimeSource?: string
): string {
  const width = number(snapshot.width)
  const height = number(snapshot.height)
  if (snapshot.bots.length > SPEAKER_ANIMATION_MAX_BOTS) throw new Error('Invalid speaker bot count')
  // This is trusted, locally installed JS. Escape raw HTML closing tags even if
  // a future library version includes one inside a string or comment.
  const script = gsapSource.replace(/<\/script/gi, '<\\/script')
  const runtime = runtimeSource ? `<script>${runtimeSource.replace(/<\/script/gi, '<\\/script')}</script>` : ''
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#000}
#speaker-card{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#000}
.layer{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
</style></head><body><div id="speaker-card" data-composition-id="speaker-card" data-duration="${SPEAKER_ANIMATION_DURATION}" data-width="${width}" data-height="${height}">
<img class="layer" data-layer="background" src="${attribute(snapshot.background)}" width="${width}" height="${height}" alt=""/>
<svg class="layer" data-layer="bots" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${snapshot.bots.map(botMarkup).join('')}</svg>
<img class="layer" data-layer="foreground" src="${attribute(snapshot.foreground)}" width="${width}" height="${height}" alt=""/>
</div><script>${script}</script><script>
(function () {
  const timeline = gsap.timeline({ paused: true });
  // Empty/hidden bots retain the same finite duration as every other card.
  timeline.to({}, { duration: ${SPEAKER_ANIMATION_DURATION} }, 0);
  const motions = ${scriptData(NEUTRAL_MOTIONS)};
  const sizes = ${scriptData(snapshot.bots.map((bot) => number(bot.size)))};
  document.querySelectorAll('[data-bot]').forEach(function (bot, index) {
    const motion = motions[index];
    const gaze = bot.querySelector('[data-gaze]');
    function translate(x, y) { return 'translate(' + x + ' ' + y + ')'; }
    const poses = [translate(0, 0), translate.apply(null, motion.gaze[0]), translate.apply(null, motion.gaze[1]), translate(0, 0)];
    // Attribute tweens also run when Hyperframes seeks with callbacks suppressed.
    // The neutral capsule paths and original matrices are never modified.
    motion.gazeAt.forEach(function (at, step) {
      timeline.fromTo(gaze, { attr: { transform: poses[step] } }, {
        attr: { transform: poses[step + 1] }, duration: motion.gazeDuration[step],
        ease: 'sine.inOut', immediateRender: false
      }, at);
    });
    const float = bot.querySelector('[data-float]');
    const peak = translate(0, sizes[index] * ${SPEAKER_ANIMATION_FLOAT_RATIO} * motion.float[0]);
    timeline.fromTo(float, { attr: { transform: translate(0, 0) } }, {
      attr: { transform: peak }, duration: motion.float[2], ease: 'sine.inOut', immediateRender: false
    }, motion.float[1]);
    timeline.fromTo(float, { attr: { transform: peak } }, {
      attr: { transform: translate(0, 0) }, duration: motion.float[4], ease: 'sine.inOut', immediateRender: false
    }, motion.float[1] + motion.float[2] + motion.float[3]);
    bot.querySelectorAll('[data-blink]').forEach(function (eye) {
      const x = Number(eye.getAttribute('data-center-x'));
      const y = Number(eye.getAttribute('data-center-y'));
      function eyelid(scale) {
        return translate(x, y) + ' scale(1 ' + scale + ') ' + translate(-x, -y);
      }
      motion.blinks.forEach(function (at) {
        const close = 0.06 + index * 0.003;
        timeline.fromTo(eye, { attr: { transform: eyelid(1) } }, {
          attr: { transform: eyelid(0.09) }, duration: close,
          ease: 'power2.in', immediateRender: false
        }, at);
        timeline.fromTo(eye, { attr: { transform: eyelid(0.09) } }, {
          attr: { transform: eyelid(1) }, duration: 0.105 + index * 0.004,
          ease: 'power2.out', immediateRender: false
        }, at + close + 0.015);
      });
    });
  });
  window.__timelines = { 'speaker-card': timeline };
})();
</script>${runtime}</body></html>`
}
