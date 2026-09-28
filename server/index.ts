import { fileURLToPath } from 'node:url'
import { createSpeakerRenderServer } from './speakerRenderService.ts'

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Speaker rendering requires Node.js 24 or newer.')
const development = process.argv.includes('--dev')
const port = Number(process.env.SPEAKER_RENDER_PORT ?? (development ? 5191 : 5190))
const host = process.env.SPEAKER_RENDER_HOST ?? '127.0.0.1'
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SPEAKER_RENDER_PORT must be a valid TCP port.')
const { server, manager, printService } = createSpeakerRenderServer({
  distDirectory: development ? undefined : fileURLToPath(new URL('../dist', import.meta.url)),
  allowedOrigins: development ? ['http://localhost:5190', 'http://127.0.0.1:5190', 'http://[::1]:5190'] : []
})
server.listen(port, host, () => console.log(`Speaker render service: http://${host}:${port}${development ? ' (development)' : ''}`))
server.on('error', (error) => { console.error(error); process.exitCode = 1; printService.close(); void manager.close() })
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  printService.close()
  server.close()
  server.closeIdleConnections()
  await manager.close()
}
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
