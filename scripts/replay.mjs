import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { glob, realpath } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { guard } from '../index.js'
import { createRetryPolicy } from '../retry.js'

if (!process.argv[2]) throw Error('Usage: npm run replay -- <backup directory>')
const root = await realpath(process.argv[2])
const files = new Map()
for await (const path of glob('*/.dsh/sessions/*/*/session*.zstd', { cwd: root })) {
  if (!files.has(dirname(path)) || path > files.get(dirname(path))) files.set(dirname(path), path)
}
if (!files.size) throw Error('No DSH sessions found')
const counts = { sessions: 0, bash: 0, jobs: 0, grep: 0, sleep: 0, retry: 0, longWaitAdvice: 0 }
for (const path of [...files.values()].sort()) {
  const child = spawn('zstd', ['-dcq', '--', path], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
  const exit = once(child, 'close')
  const pending = new Map()
  let agent, now
  const retry = createRetryPolicy(() => now)
  for await (const line of createInterface({ input: child.stdout })) {
    const { type, data, time, seq, parentSession, delegationDepth, id, cwd } = JSON.parse(line)
    if (type === 'session' && !parentSession && !delegationDepth) { agent = { id, cwd }; counts.sessions++ }
    if (!agent) continue
    now = time
    if (type === 'tool/call' && ['bash', 'job_output'].includes(data.name)) {
      let args = data.arguments
      try { if (typeof args === 'string') args = JSON.parse(args) } catch { continue }
      const exec = { name: data.name, arguments: args, agent }
      const hint = guard(exec)
      let rule
      if (exec.name === 'bash') counts.bash++
      else counts.jobs++
      if (hint) rule = hint.includes('grep') ? 'grep' : 'sleep'
      else if (retry.guard(exec)) rule = 'retry'
      else if (exec.name === 'job_output' && args?.wait === true && (args.timeout_ms ?? Infinity) > 5000) rule = 'longWaitAdvice'
      if (rule) {
        counts[rule]++
        if (process.argv.includes('--examples')) console.log(path.split('/')[0], basename(dirname(path)), seq, rule)
      }
      if (exec.name === 'bash' && !rule) pending.set(data.callId, { exec, time })
    } else if (type === 'tool/result') {
      const msg = data.message
      const key = msg?.toolCallId ?? msg?.source?.callId
      const call = pending.get(key)
      if (call) { retry.observe(call.exec, now - call.time, false); pending.delete(key) }
    }
  }
  if ((await exit)[0] !== 0) throw Error('Decompression failed: ' + path)
}
console.log(JSON.stringify(counts))
