export function isPaceShell(name) {
  return name === 'bash' || name === 'pwsh'
}

const doubleQuotedWord = String.raw`"(?:[^"$]|\$(?!\())*"`
const findSubstitution = String.raw`\$\([ \t]*(?:/usr/bin/)?find[ \t]+(?:[^(){}'";&]|'[^']*'|${doubleQuotedWord})*\)`
const findOperand = new RegExp(`^${findSubstitution}$`)
const simpleBashToken = new RegExp(String.raw`[ \t]+|&&|\|\||\|&|[;|&]|(?:${findSubstitution}|'[^']*'|${doubleQuotedWord}|[^\s;&|(){}<>'"$]+|\$(?!\())+`, 'gy')
const compoundCommand = /^(?:if|then|elif|else|fi|for|select|while|until|do|done|case|esac|function|coproc|time|!|\[\[)$/

// Recognize simple command lists only, with command substitutions kept as single words.
export function catMayWaitForStdin(command) {
  if (!command.includes('$(') || !command.includes('cat') || /[\\`#\r\n]/.test(command)) return false

  let end = 0
  let piped = false
  let mayWait = false
  let words = []
  for (const [token] of `${command};`.matchAll(simpleBashToken)) {
    end += token.length
    if (/^[ \t]/.test(token)) continue
    if (['&&', '||', '&'].includes(token)) return false
    if (![';', '|', '|&'].includes(token)) {
      words.push(token)
      continue
    }

    const [executable, ...args] = words
    if (compoundCommand.test(executable)) return false
    if (!piped && /^(?:\/(?:usr\/)?bin\/)?cat$/.test(executable)) {
      const operands = args[0] === '--' ? args.slice(1) : args
      if (operands.length && operands.every(operand => findOperand.test(operand))) mayWait = true
    }
    piped = token !== ';'
    words = []
  }
  return end === command.length + 1 && mayWait
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
