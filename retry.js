import { isPaceShell } from './shell.js'

function bashSearch(command) {
  if (command.includes('\\')) return
  const prefix = command.match(/^cd\s+([\w./-]+)\s*&&\s*/)
  const body = command.slice(prefix?.[0].length ?? 0).replace(/^command -v rg\s*(?:&&\s*rg --version\s*\|\s*head -1\s*&&|\|\|\s*true;)\s*/, '')
  const match = body.match(/^(?:time\s+)?(?:[\w./-]+\/)?rg\s+(.+)$/)
  if (match) return { directory: prefix?.[1] ?? '.', args: match[1].replace(/\s*\|\s*(?:wc -l|head(?: -\d+| -n \d+)?)$/, '') }
}

function pwshSearch(command) {
  // DSH passes the working directory separately. Only match a direct rg call.
  const match = command.match(/^(?:[\w.:/\\-]+[/\\])?rg(?:\.exe)?\s+(.+)$/i)
  if (match) return { directory: '.', args: match[1] }
}

function searchKey(exec) {
  const cmd = exec.arguments?.command
  if (!isPaceShell(exec.name) || !exec.agent?.id || typeof cmd !== 'string' || cmd.length > 4096 || exec.arguments.run_in_background || /[\r\n`$<>]/.test(cmd)) return
  const pwsh = exec.name === 'pwsh'
  const search = pwsh ? pwshSearch(cmd.trim()) : bashSearch(cmd.trim())
  if (!search) return
  const words = search.args.match(/'[^']*'|"[^"]*"|[^\s]+/g) ?? []
  const operands = []
  let options = true
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    if (options && word === '--') {
      options = false
      continue
    }
    if (options && (word === '-g' || word === '--glob')) {
      if (!/^['"]?![\p{L}\p{M}\p{N}_.*\/-]+['"]?$/u.test(words[++index] ?? '')) return
      continue
    }
    if (options && /^(?:--hidden|-[nFilH]+)$/.test(word)) continue

    const value = word.replace(/^['"]|['"]$/g, '')
    const currentDirectory = pwsh && operands.length === 1 && value === '.\\'
    if (!currentDirectory) {
      if (options && value.startsWith('-')) return
      if (!/^(?:'[\p{L}\p{M}\p{N}_./ :+-]+'|"[\p{L}\p{M}\p{N}_./ :+-]+"|[\p{L}\p{M}\p{N}_./:+-]+)$/u.test(word)) return
    }
    operands.push(currentDirectory ? '.' : value)
  }
  if (!operands.length || operands.length > 2) return
  const [pattern, target = '.'] = operands
  if (target !== '.' && target !== './') return
  return JSON.stringify([exec.agent.id, exec.arguments.workdir ?? exec.agent.session?.header?.cwd ?? exec.agent.cwd ?? '', search.directory, pattern])
}

export function createRetryPolicy(clock = Date.now) {
  const recent = new Map()
  const disposed = new WeakSet()
  return {
    disposeSession(session) {
      disposed.add(session)
      for (const [key, record] of recent) {
        if (record.sessionId === session.id) recent.delete(key)
      }
    },
    guard(exec) {
      const key = searchKey(exec)
      if (!recent.has(key)) return
      if (clock() - recent.get(key).time < 900_000) return 'Pace：本会话刚执行过同关键词、同根目录的慢搜索。请缩到具体子目录，或用 -t / 正向 -g 限定文件类型，再试。'
      recent.delete(key)
    },
    observe(exec, elapsed, timeout) {
      if (!(elapsed >= 60_000 || timeout) || disposed.has(exec.agent?.session)) return
      const key = searchKey(exec)
      if (!key) return
      recent.delete(key)
      recent.set(key, { sessionId: exec.agent.id, time: clock() })
      if (recent.size > 256) recent.delete(recent.keys().next().value)
    },
  }
}
