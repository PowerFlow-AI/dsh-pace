export function isPaceShell(name) {
  return name === 'bash' || name === 'pwsh'
}

export function isBroadPath(path, pwsh) {
  if (pwsh) path = path.replaceAll('\\', '/')
  return /^(?:\.|\.\.|~|\$PWD|\$HOME|\*)\/?$/.test(path) || path === '/' ||
    (pwsh && /^(?:[a-z]:\/|\.\/\*)$/i.test(path))
}

export function longForegroundSleep(command, pwsh) {
  if (!pwsh) {
    const sleep = command.match(/^\s*(?:\/bin\/)?sleep\s+(\d+(?:\.\d+)?)([smh]?)\s*(?:$|;|&&)/)
    if (!sleep) return false
    const [, amount, unit] = sleep
    return Number(amount) * ({ m: 60, h: 3600 }[unit] ?? 1) >= 60
  }
  const match = command.match(/^\s*(?:Start-Sleep|sleep)\s+(?:-(Seconds|Milliseconds|ms)(?:[ \t]+|:))?(\d+(?:\.\d+)?)[ \t]*(?=$|[;\r\n]|&&)/i)
  if (!match) return false
  const [, unit, amount] = match
  return Number(amount) >= (/^(?:Milliseconds|ms)$/i.test(unit) ? 60_000 : 60)
}

// Recognize only an unfiltered recursive listing feeding Select-String.
export function broadPwshListing([cmd, ...args]) {
  if (!/^(?:Get-ChildItem|gci|dir|ls)$/i.test(cmd)) return false
  let recursive = false
  for (let i = 0; i < args.length; i++) {
    if (/^-Recurse$/i.test(args[i])) recursive = true
    else if (!/^-(?:File|Force)$/i.test(args[i])) {
      if (/^-(?:Literal)?Path$/i.test(args[i])) i++
      if (!args[i] || !isBroadPath(args[i], true)) return false
    }
  }
  return recursive
}
