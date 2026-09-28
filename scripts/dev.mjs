import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Speaker rendering requires Node.js 24 or newer.')
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const vite = fileURLToPath(new URL('./bin/vite.js', `file://${require.resolve('vite/package.json')}`))
const children = [
  spawn(process.execPath, ['server/index.ts', '--dev'], { cwd: root, stdio: 'inherit', env: process.env }),
  spawn(process.execPath, [vite, '--host', '127.0.0.1', '--strictPort', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env: process.env })
]
let stopping = false
function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
}
for (const child of children) {
  child.on('error', (error) => { console.error(error); stop(1) })
  child.on('exit', (code) => { if (!stopping) stop(code ?? 1) })
}
process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
