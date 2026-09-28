import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createSpeakerComposition } from '../src/shared/speakerAnimation.ts'

// This function runs in either the player iframe or a standalone composition page.
function inspectNeutralTimeline() {
  const timeline = window.__timelines['speaker-card']
  const bots = [...document.querySelectorAll('[data-bot]')]
  const layers = [...document.querySelectorAll('img')]
  const layerSources = layers.map((image) => image.getAttribute('src'))
  const neutralPaths = () => JSON.stringify([...document.querySelectorAll('path[data-eye]')].map((eye) => ({
    d: eye.getAttribute('d'), transform: eye.getAttribute('transform'), opacity: eye.getAttribute('opacity')
  })))
  const transforms = (selector) => bots.map((bot) => JSON.stringify([...bot.querySelectorAll(selector)].map((element) => element.getAttribute('transform'))))
  const motion = () => transforms('[data-gaze], [data-blink], [data-float]')
  const still = () => JSON.stringify({
    bodies: [...document.querySelectorAll('[data-body], [data-body-mask]')].map((path) => path.outerHTML),
    placement: bots.map((bot) => ({ transform: bot.getAttribute('transform'), rotation: bot.querySelector('[data-rotation]')?.getAttribute('transform'), width: bot.querySelector('svg')?.getAttribute('width'), height: bot.querySelector('svg')?.getAttribute('height') })),
    layers: layers.map((image) => [...image.attributes].filter((attribute) => attribute.name !== 'src').map((attribute) => [attribute.name, attribute.value]))
  })
  timeline.seek(0)
  const originalEyes = neutralPaths()
  const originalStill = still()
  const neutral = motion()
  const originalGaze = transforms('[data-gaze]')
  const originalBlink = transforms('[data-blink]')
  const originalFloat = transforms('[data-float]')
  const failures = []
  const cycles = []
  for (let loop = 0; loop < 2; loop++) {
    timeline.seek(0)
    const gazeSamples = bots.map(() => 0)
    const blinkSamples = bots.map(() => 0)
    const floatSamples = bots.map(() => 0)
    const timing = bots.map(() => '')
    for (let step = 0; step <= 240; step++) {
      const time = step / 40
      timeline.seek(time)
      if (neutralPaths() !== originalEyes) failures.push(`Neutral eye geometry changed at ${time}s`)
      if (still() !== originalStill) failures.push(`Body geometry or static artwork changed at ${time}s`)
      if (layers.some((image, index) => image.getAttribute('src') !== layerSources[index])) failures.push(`Raster layer changed at ${time}s`)
      const gazes = transforms('[data-gaze]')
      const blinks = transforms('[data-blink]')
      const floats = transforms('[data-float]')
      bots.forEach((bot, index) => {
        const gazeChanged = gazes[index] !== originalGaze[index]
        const blinkChanged = blinks[index] !== originalBlink[index]
        if (gazeChanged) gazeSamples[index]++
        if (blinkChanged) blinkSamples[index]++
        if (floats[index] !== originalFloat[index]) floatSamples[index]++
        timing[index] += `${Number(gazeChanged)}${Number(blinkChanged)}`
        const float = bot.querySelector('[data-float]')?.getAttribute('transform') ?? ''
        const coordinates = /^translate\(\s*([-+.\deE]+)[,\s]+([-+.\deE]+)\s*\)$/.exec(float)
        const size = Number(bot.querySelector('svg')?.getAttribute('width'))
        if (!coordinates || Number(coordinates[1]) !== 0 || Math.abs(Number(coordinates[2])) > size * 0.003 + 0.0001) {
          failures.push(`Float exceeds subtle vertical movement at ${time}s for bot ${index}`)
        }
      })
    }
    if (JSON.stringify(motion()) !== JSON.stringify(neutral)) failures.push(`Loop ${loop + 1} does not match its starting pose`)
    cycles.push({ gazeSamples, blinkSamples, floatSamples, distinctTimings: new Set(timing).size })
  }
  const seek = (time) => { timeline.seek(time); return motion() }
  const first = seek(1.4)
  seek(4.2)
  const second = seek(1.4)
  if (JSON.stringify(first) !== JSON.stringify(second)) failures.push('Animation seeking is not deterministic')
  if (JSON.stringify(seek(0.01)) !== JSON.stringify(neutral)) failures.push('Opening seam is moving')
  if (JSON.stringify(seek(5.99)) !== JSON.stringify(neutral)) failures.push('Closing seam is moving')
  timeline.seek(0)
  return {
    duration: timeline.duration(),
    eyesPerBot: bots.map((bot) => bot.querySelectorAll('path[data-eye]').length),
    cycles, failures
  }
}

function assertNeutralTimeline(check, count, context) {
  assert.equal(check.duration, 6, `${context}: finite duration`)
  assert.deepEqual(check.eyesPerBot, Array(count).fill(2), `${context}: eyes`)
  assert.deepEqual(check.failures, [], context)
  for (const { gazeSamples, blinkSamples, floatSamples, distinctTimings } of check.cycles) {
    for (const [kind, samples] of [['gaze', gazeSamples], ['blink', blinkSamples], ['float', floatSamples]]) {
      assert.ok(samples.every((samples) => samples > 0), `${context}: every bot has ${kind} motion`)
    }
    assert.equal(distinctTimings, count, `${context}: each bot has its own timing`)
  }
}

// Run against pnpm dev. A fresh browser profile leaves saved user variants intact.
const require = createRequire(import.meta.resolve('@hyperframes/producer'))
const { default: puppeteer } = await import(require.resolve('puppeteer'))
const gsapSource = await readFile(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'), 'utf8')
const directory = resolve('output/speaker-animation-check')
await mkdir(directory, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.HYPERFRAMES_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true
})
const page = await browser.newPage()
const errors = []
const remoteRequests = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => { if (/^https?:/.test(request.url()) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(request.url())) remoteRequests.push(request.url()) })
await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 1 })
const base = process.env.SPEAKER_APP_URL ?? 'http://127.0.0.1:5190'
try {
  await page.goto(`${base}/#etat=idle&stop`, { waitUntil: 'networkidle0' })
  await page.evaluate(async () => { const { langue } = await import('/src/i18n/index.ts'); langue.value = 'en' })
  await page.waitForSelector('button[aria-label="Speakers"]', { visible: true })
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Speakers"]').closest('[inert]'))
  await page.click('button[aria-label="Speakers"]')
  await page.waitForSelector('input[name="speaker-format"][value="mp4"]')
  await page.click('input[name="speaker-format"][value="mp4"] + span')
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready, { timeout: 30_000 })
  await page.waitForFunction(() => document.querySelector('button[aria-label="Pause preview"]'))
  await page.screenshot({ path: resolve(directory, 'editor.png'), fullPage: true })
  const initial = await page.evaluate(() => {
    const player = document.querySelector('hyperframes-player')
    return { duration: player.duration, paused: player.paused }
  })
  assert.equal(initial.duration, 6)
  assert.equal(initial.paused, false)
  await page.click('button[aria-label="Pause preview"]')
  assert.equal(await page.evaluate(() => document.querySelector('hyperframes-player').paused), true)
  const frame = page.frames().find((frame) => frame.url() === 'about:srcdoc')
  assert.ok(frame, 'Player composition iframe')
  const animationCheck = await frame.evaluate(inspectNeutralTimeline)
  assertNeutralTimeline(animationCheck, 5, 'Player preview')
  console.log('Preview ready: finite 6s, neutral gaze/blinks, independent timing, tiny float, unchanged shapes and deterministic seeking across two seamless loops.')

  const snapshots = await page.evaluate(async () => {
    const { createSpeakerDraft } = await import('/src/ui/speaker.ts')
    const { loadSpeakerBots, renderSpeaker, renderSpeakerLayers } = await import('/src/ui/speakerRender.ts')
    const { createSpeakerAnimationSnapshot } = await import('/src/ui/speakerAnimation.ts')
    const portrait = new Image()
    portrait.src = '/speakers/walter-morales.png'
    await portrait.decode()
    const assets = { portrait, bots: await loadSpeakerBots() }
    const output = []
    const hidden = []
    for (const aspect of ['4:3', '1:1', '9:16']) {
      for (const botsScale of [60, 100, 130]) {
        const draft = { ...createSpeakerDraft(), aspect, botsScale, talkTitle: 'Building with\nGrok Bot' }
        const width = aspect === '9:16' ? 540 : 960
        const snapshot = await createSpeakerAnimationSnapshot(draft, assets, width)
        const canvas = document.createElement('canvas')
        renderSpeaker(canvas, draft, assets, width)
        output.push({ aspect, botsScale, snapshot, still: canvas.toDataURL('image/png') })
      }
      const noBots = await createSpeakerAnimationSnapshot({ ...createSpeakerDraft(), aspect, botsVisible: false }, assets, 400)
      if (noBots.bots.length) throw new Error('Hidden bots appeared in animation')
      hidden.push({ aspect, snapshot: noBots })
      // Shared passes retain every static pixel outside bot geometry.
      const draft = { ...createSpeakerDraft(), aspect, botsVisible: false }
      const canvas = document.createElement('canvas')
      renderSpeaker(canvas, draft, assets, 400)
      const layers = renderSpeakerLayers(draft, assets, 400)
      const composed = document.createElement('canvas')
      composed.width = canvas.width; composed.height = canvas.height
      const ctx = composed.getContext('2d')
      ctx.drawImage(layers.background, 0, 0); ctx.drawImage(layers.foreground, 0, 0)
      const before = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const after = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let maximum = 0
      for (let i = 0; i < before.length; i++) maximum = Math.max(maximum, Math.abs(before[i] - after[i]))
      // Compositing a transparent text layer can round an antialiased edge by1.
      if (maximum > 1) throw new Error(`Static layers differ in ${aspect}; maximum channel difference ${maximum}`)
    }
    const mp4 = await createSpeakerAnimationSnapshot({ ...createSpeakerDraft(), talkTitle: 'Building with\nGrok Bot' }, assets)
    return { output, hidden, mp4 }
  })
  for (const { aspect, botsScale, still } of snapshots.output) {
    await writeFile(resolve(directory, `still-${aspect.replace(':', 'x')}-${botsScale}.png`), Buffer.from(still.split(',')[1], 'base64'))
  }
  const compositionPage = await browser.newPage()
  compositionPage.on('pageerror', (error) => errors.push(error.message))
  try {
    for (const { aspect, botsScale, snapshot } of [...snapshots.output, ...snapshots.hidden]) {
      await compositionPage.setViewport({ width: snapshot.width, height: snapshot.height, deviceScaleFactor: 1 })
      await compositionPage.setContent(createSpeakerComposition(snapshot, gsapSource), { waitUntil: 'load' })
      await compositionPage.evaluate(() => Promise.all([...document.images].map((image) => image.decode())))
      const check = await compositionPage.evaluate(inspectNeutralTimeline)
      const context = `${aspect}, ${botsScale ?? 'hidden'} bots`
      assertNeutralTimeline(check, snapshot.bots.length, context)
      if (botsScale === 100) {
        for (const time of [0, 1, 2, 3, 4, 5]) {
          await compositionPage.evaluate((time) => { window.__timelines['speaker-card'].seek(time) }, time)
          await compositionPage.screenshot({ path: resolve(directory, `neutral-${aspect.replace(':', 'x')}-${time}s.png`) })
        }
      }
      console.log(`Two complete timeline cycles verified: ${context}.`)
    }
  } finally {
    await compositionPage.close()
  }
  console.log('All 3 aspects, scales 60/100/130 and hidden bots: two neutral cycles, individual gaze/blinks, tiny float, preserved artwork and seamless repetition pass.')
  if (process.argv.includes('--interaction')) {
    await page.click('button[aria-label="Play preview"]')
    await page.click('nav li:first-child button')
    await page.waitForFunction(() => document.querySelector('hyperframes-player').paused)
    await page.click('button[aria-label="Speakers"]')
    await page.waitForFunction(() => !document.querySelector('hyperframes-player').paused)
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.waitForFunction(() => document.querySelector('hyperframes-player').paused)
    await page.click('input[name="speaker-format"][value="gif"] + span')
    const client = await page.createCDPSession()
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: directory })
    const created = page.waitForResponse((response) => response.url().endsWith('/api/speaker-renders') && response.request().method() === 'POST')
    await page.evaluate(() => [...document.querySelectorAll('.speaker-editor header button')].find((button) => button.textContent.trim() === 'Download').click())
    const cancelledJob = await (await created).json()
    await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Cancel export').click())
    await page.waitForFunction(() => document.querySelector('.speaker-editor').textContent.includes('Export cancelled'), { timeout: 45_000 })
    const cancelled = await (await fetch(`${base}/api/speaker-renders/${cancelledJob.id}`)).json()
    assert.equal(cancelled.status, 'cancelled')
    const restarted = page.waitForResponse((response) => response.url().endsWith('/api/speaker-renders') && response.request().method() === 'POST')
    await page.evaluate(() => [...document.querySelectorAll('.speaker-editor header button')].find((button) => button.textContent.trim() === 'Download').click())
    assert.equal((await restarted).status(), 202, 'Immediate retry must have a free render slot')
    await page.waitForFunction(() => document.querySelector('.speaker-editor').textContent.includes('File downloaded'), { timeout: 180_000 })
    console.log('Actual UI cancel/immediate retry/download, hidden view and reduced motion pass.')
    await page.click('input[name="speaker-aspect"][value="9:16"] + span')
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
    await page.waitForFunction(() => {
      const player = document.querySelector('hyperframes-player')
      return player?.ready && Math.abs(Number(player.getAttribute('height')) / Number(player.getAttribute('width')) - 16 / 9) < 0.002
    })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile horizontal overflow')
    await page.screenshot({ path: resolve(directory, 'mobile.png'), fullPage: true })
    console.log('Actual UI cancel/immediate retry/download, hidden view, reduced motion and mobile9:16 pass.')
  }
  if (process.argv.includes('--render')) {
    for (const [format, snapshot] of [['mp4', snapshots.mp4], ['gif', snapshots.output[1].snapshot]]) {
      const response = await fetch(`${base}/api/speaker-renders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, snapshot }) })
      assert.equal(response.status, 202, await response.clone().text())
      let job = await response.json()
      const start = Date.now()
      let reported = -1
      while (['queued', 'rendering', 'cancelling'].includes(job.status)) {
        assert.ok(Date.now() - start < 600_000, 'Render exceeded10min')
        await new Promise((resolve) => setTimeout(resolve, 1000))
        job = await (await fetch(`${base}/api/speaker-renders/${job.id}`)).json()
        if (Math.floor(job.progress / 10) !== reported) { reported = Math.floor(job.progress / 10); console.log(`${format}: ${job.status} ${job.progress}%`) }
      }
      assert.equal(job.status, 'completed', JSON.stringify(job))
      const file = await fetch(`${base}/api/speaker-renders/${job.id}/file`)
      assert.equal(file.headers.get('Content-Type'), format === 'mp4' ? 'video/mp4' : 'image/gif')
      const bytes = Buffer.from(await file.arrayBuffer())
      const path = resolve(directory, `speaker.${format}`)
      await writeFile(path, bytes)
      if (format === 'gif') {
        const loopExtension = bytes.indexOf(Buffer.from('NETSCAPE2.0'))
        assert.ok(loopExtension >= 0, 'GIF loop extension')
        assert.equal(bytes[loopExtension + 11], 3, 'GIF loop extension data size')
        assert.equal(bytes[loopExtension + 12], 1, 'GIF loop extension sub-block')
        assert.equal(bytes.readUInt16LE(loopExtension + 13), 0, 'GIF repeats infinitely')
        assert.equal(bytes[loopExtension + 15], 0, 'GIF loop extension terminator')
      }
      const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames:format=duration', '-of', 'json', path], { encoding: 'utf8' }))
      assert.equal(info.streams[0].width, snapshot.width)
      assert.equal(info.streams[0].height, snapshot.height)
      assert.equal(Number(info.streams[0].nb_frames), format === 'mp4' ? 180 : 90)
      assert.equal(info.streams[0].r_frame_rate, format === 'mp4' ? '30/1' : '15/1')
      assert.ok(Math.abs(Number(info.format.duration) - 6) < 0.1)
      console.log(`${format}: ${bytes.length} bytes, ${JSON.stringify(info)}`)
    }
  }
  assert.deepEqual(errors, [], 'Browser runtime errors')
  assert.ok(!remoteRequests.some((url) => /hyperframe|gsap|jsdelivr|unpkg/.test(url)), 'Animation runtime must be local')
  console.log(`Verification complete: ${directory}`)
} catch (error) {
  await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {})
  console.error('Browser errors:', errors)
  console.error('Remote requests:', remoteRequests)
  throw error
} finally {
  await browser.close()
}
