function searchKey(exec) {
  const cmd = exec.arguments?.command
  if (exec.name !== 'bash' || !exec.agent?.id || typeof cmd !== 'string' || cmd.length > 4096 || exec.arguments.run_in_background || /[\n`$<>\\]/.test(cmd)) return
  const prefix = cmd.trim().match(/^cd\s+([\w./-]+)\s*&&\s*/)
  const body = cmd.trim().slice(prefix?.[0].length ?? 0).replace(/^command -v rg\s*(?:&&\s*rg --version\s*\|\s*head -1\s*&&|\|\|\s*true;)\s*/, '')
  const match = body.match(/^(?:time\s+)?(?:[\w./-]+\/)?rg\s+(.+)$/)
  if (!match) return
  const args = match[1].replace(/\s*\|\s*(?:wc -l|head(?: -\d+| -n \d+)?)$/, '')
  const words = args.match(/'[^']*'|"[^"]*"|[^\s]+/g) ?? []
  const operands = []
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    if (word === '-g' || word === '--glob') {
      if (!/^['"]?![\w.*\/-]+['"]?$/.test(words[++index] ?? '')) return
    } else if (!/^(?:--hidden|-[nFilH]+)$/.test(word)) {
      if (!/^(?:'[\w./ :+-]+'|"[\w./ :+-]+"|[\w./:+-]+)$/.test(word) || word.startsWith('-')) return
      operands.push(word.replace(/^['"]|['"]$/g, ''))
    }
  }
  if (!operands.length || operands.length > 2) return
  const [pattern, target = '.'] = operands
  if (target !== '.' && target !== './') return
  return JSON.stringify([exec.agent.id, exec.arguments.workdir ?? exec.agent.cwd ?? '', prefix?.[1] ?? '.', pattern])
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
