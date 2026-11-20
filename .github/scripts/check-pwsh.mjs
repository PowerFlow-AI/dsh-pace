import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as pace from '../../index.js'

const host = createRequire(resolve(process.env.DSH_HOST_DIR, 'package.json'))
const fromHost = name => import(pathToFileURL(host.resolve('@deepseek-ai/' + name)))
const { Context } = await fromHost('cordis')
const ctx = new Context()
const cwd = mkdtempSync(join(tmpdir(), 'pace-pwsh-'))
const id = 'pwsh-smoke'
const agent = { id, session: { id, header: { id, cwd } } }
let serial = 0
const invoke = (command, timeoutMs = 5000) => ctx.tools.execute({
  name: 'pwsh', agent, arguments: { command, timeoutMs, description: 'Check the Pace PowerShell guard' },
  callId: String(++serial), signal: new AbortController().signal,
})
try {
  for (const name of ['dsh-tools', 'dsh-system-prompt', 'dsh-subprocess-local', 'dsh-pwsh-local']) {
    await ctx.plugin((await fromHost(name)).default, {})
  }
  await ctx.plugin(await fromHost('dsh-shell-env'), { dshHome: cwd })
  await ctx.plugin(await fromHost('dsh-tool-pwsh'), { enableRunInBackground: false })
  await ctx.plugin(pace)
  const ready = await invoke("Start-Sleep -Milliseconds 1; Write-Output 'ready'")
  assert.equal(ready.value?.stdout.text.trim(), 'ready', JSON.stringify(ready))
  for (const command of ['Start-Sleep -Seconds 60', 'grep -Rn needle .', 'Get-ChildItem -Recurse | Select-String needle']) {
    const refused = await invoke(command)
    assert.equal(refused.isError, true)
    assert.match(JSON.stringify(refused.content), /Pace/)
  }
  const slow = await invoke('rg needle .', 1)
  assert.equal(slow.value?.timedOut, true, JSON.stringify(slow))
  const retry = await invoke('rg needle .')
  assert.equal(retry.isError, true)
  assert.match(JSON.stringify(retry.content), /Pace/)
  console.log('PASS: DSH pwsh command, foreground guards and timeout retry')
} finally {
  await ctx.fiber.dispose()
  rmSync(cwd, { recursive: true, force: true })
}
