export function isPaceShell(name) {
  return name === 'bash' || name === 'pwsh'
}

// Match complete raw words so callers can distinguish quoted data from operators.
const singleQuoted = /'[^']*'/.source
const doubleQuoted = /"(?:[^"$\\`]|\\.|\$(?![({\[]))*"/.source
const bare = /[^\s;&|(){}<>'"$\\`]|\$(?![('"{\[])/.source
const bashWord = `(?:${singleQuoted}|${doubleQuoted}|${bare})+`
const findSubstitution = String.raw`\$\([ \t]*(?:/usr/bin/)?find[ \t](?:[^(){}'";&#\\\x60]|${singleQuoted}|${doubleQuoted})*\)`
const findOperand = new RegExp(`^${findSubstitution}$`)
const separators = /[ \t]+|&&|\|\||\|&|[;|&]/.source
const redirect = String.raw`(?:&>>?|\d*(?:>>?|<)&?)[ \t]*(?!#)${bashWord}`
const searchToken = new RegExp(`${redirect}|${separators}|${bashWord}`, 'gy')
const catToken = new RegExp(`${separators}|(?:${findSubstitution}|${singleQuoted}|${doubleQuoted}|${bare})+`, 'gy')

// PowerShell paths use backslashes. Only ordinary quoted strings and simple commands are recognized.
const pwshDoubleQuoted = /"(?:[^"$`]|\$(?![({]))*"/.source
const pwshBare = /[^\s;&|(){}<>'"$@`]|\$(?![({])|@(?!['"])/.source
const pwshWord = `(?:${singleQuoted}|${pwshDoubleQuoted}|${pwshBare})+`
const pwshToken = new RegExp(String.raw`\d*>>?&?[ \t]*(?!#)${pwshWord}|[ \t]+|&&|\|\||[;|&]|${pwshWord}`, 'gy')

function tokenize(command, tokenPattern) {
  if (command.length > 16_384 || /[\r\n]/.test(command)) return
  const tokens = []
  let end = 0
  for (const [raw] of command.matchAll(tokenPattern)) {
    if (raw.startsWith('#')) return
    end += raw.length
    if (!/^[ \t]/.test(raw)) tokens.push(raw)
  }
  if (end === command.length) return tokens
}

export function searchTokens(command, pwsh) {
  if (pwsh && /[‘’‚‛“”„‟]/.test(command)) return
  return tokenize(command, pwsh ? pwshToken : searchToken)
}

export function wordValue(raw, pwsh) {
  if (pwsh) return raw.replace(/'((?:[^']|'')*)'|"((?:[^"]|"")*)"/g, (_, single, double) =>
    single === undefined ? double.replaceAll('""', '"') : single.replaceAll("''", "'"))
  // Bash only consumes a backslash inside double quotes before these characters.
  return raw.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (_, single, double) =>
    single ?? double.replace(/\\(["\\$`])/g, '$1'))
}

const compoundCommand = /^(?:if|then|elif|else|fi|for|select|while|until|do|done|case|esac|function|coproc|time|!|\[\[)$/

// Recognize simple command lists only, with command substitutions kept as single words.
export function catMayWaitForStdin(command) {
  if (!command.includes('$(') || !command.includes('cat')) return false
  const tokens = tokenize(command, catToken)
  if (!tokens) return false

  let piped = false
  let mayWait = false
  let words = []
  for (const token of [...tokens, ';']) {
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
  return mayWait
}

export function isBroadPath(raw, pwsh, expandWildcards) {
  const value = wordValue(raw, pwsh)
  const path = pwsh ? value.replaceAll('\\', '/') : value
  if (path === '/' || /^\.{1,2}\/?$/.test(path)) return true
  if (pwsh && /^[a-z]:\/$/i.test(path)) return true
  if (/^~\/?$/.test(path)) return pwsh || raw.startsWith('~')
  if (/^\$(?:PWD|HOME)\/?$/.test(path)) return /^"?\$(?:PWD|HOME)\b/.test(raw)
  if (!/^(?:\.?\/)?\*\/?$/.test(path)) return false
  // PowerShell providers expand wildcard paths even in quotes, except with -LiteralPath.
  return expandWildcards ?? /\*[\\/]?$/.test(raw)
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
      const literalPath = /^-LiteralPath$/i.test(args[i])
      if (literalPath || /^-Path$/i.test(args[i])) i++
      if (!args[i] || !isBroadPath(args[i], true, !literalPath)) return false
    }
  }
  return recursive
}
