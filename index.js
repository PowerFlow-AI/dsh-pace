import { broadPwshListing, catMayWaitForStdin, isBroadPath, isPaceShell, longForegroundSleep, searchTokens, wordValue } from './shell.js'
import { createRetryPolicy } from './retry.js'

export const name = 'dsh-pace'
export const inject = ['systemPrompt', 'tools']

const policy = `## Pace：让下一步尽快可见
先回答用户要判断的事；侦查先查已知文件，再按目录、类型扩展。优先 rg / 工作区搜索；rg --hidden 从根目录扫也可能很慢。不要把 head 当作搜索超时。
慢任务先报启动状态。job_output 先用 wait:false 查看现状；确需等时用 wait:true、timeout_ms:5000，不连续轮询，保留作业等完成通知。一次查不到就报告已知事实和下一步。长命令按可验证的步骤拆开；复杂脚本用文件，保留必要的事务与清理。`

const searchHint = 'Pace：递归搜索范围过大。先用 rg -n -F -- "字面量" 具体目录/；查正则时去掉 -F，并按需要用 -g 限定文件类型。'
const waitHint = 'Pace：不要在前台先空等一分钟再查。现在先查看进程、日志或作业状态；必要时短等后再查。'
const stdinHint = 'Pace：find 没有结果时，未加引号的 $(find ...) 会让 cat 失去文件参数并等待终端输入。先执行 file=$(find ... -print -quit)，确认 [ -n "$file" ] 后再用 cat -- "$file" 或 head -c 2000 "$file"。'

const bashWrappers = new Set(['time', 'command', 'sudo', 'nohup', 'env'])

function broadGrep(words, piped, pwsh) {
  const start = pwsh ? 0 : words.findIndex(raw => !/^[a-zA-Z_]\w*=/.test(raw) && !bashWrappers.has(wordValue(raw, false)))
  const command = words[start]
  const executable = pwsh ? /^(?:.*[\\/])?grep(?:\.exe)?$/i : /^(?:.*\/)?grep$/
  if (!command || !executable.test(pwsh ? command : wordValue(command, false))) return false
  let recursive = false, pattern = false, options = true
  const paths = []
  for (let index = start + 1; index < words.length; index++) {
    const word = wordValue(words[index], pwsh)
    if (options && word === '--') { options = false; continue }
    if (options && word.startsWith('--')) {
      const [key] = word.split('=')
      if (['--recursive', '--dereference-recursive'].includes(key)) recursive = true
      else if (['--exclude-dir', '--exclude', '--include', '--regexp', '--file'].includes(key)) {
        if (!word.includes('=') && ++index >= words.length) return false
        if (key === '--regexp' || key === '--file') pattern = true
      } else return false
    } else if (options && /^-[^-]/.test(word)) {
      for (const [offset, flag] of [...word.slice(1)].entries()) {
        if ('rR'.includes(flag)) recursive = true
        else if ('efABCm'.includes(flag)) {
          if (flag === 'e' || flag === 'f') pattern = true
          if (offset + 2 === word.length && ++index >= words.length) return false
          break
        } else if (!'nIiEFlLwshHvocqa'.includes(flag)) return false
      }
    } else if (!pattern) pattern = true
    else paths.push(words[index])
  }
  return recursive && pattern && ((!paths.length && !piped) || paths.length >= 4 || paths.some(path => isBroadPath(path, pwsh)))
}

export function guard(execution) {
  const cmd = execution?.arguments?.command
  if (!isPaceShell(execution?.name) || typeof cmd !== 'string') return
  const pwsh = execution.name === 'pwsh'
  if (execution.arguments.run_in_background !== true) {
    if (longForegroundSleep(cmd, pwsh)) return waitHint
    if (!pwsh && catMayWaitForStdin(cmd)) return stdinHint
  }
  const tokens = searchTokens(cmd, pwsh)
  if (!tokens) return
  let words = []
  let piped = false
  let broadListing = false
  for (const token of [...tokens, ';']) {
    if ([';', '|', '|&', '&', '&&', '||'].includes(token)) {
      if (broadGrep(words, piped, pwsh)) return searchHint
      if (broadListing && /^(?:Select-String|sls)$/i.test(words[0])) return searchHint
      broadListing = pwsh && !piped && token === '|' && broadPwshListing(words)
      words = []; piped = token === '|' || token === '|&'
    } else if (/^(?:\d*[<>]|&>)/.test(token)) {
      if (/^0*</.test(token)) piped = true
    } else {
      words.push(token)
    }
  }
}

export function apply(ctx) {
  const retry = createRetryPolicy()
  ctx.on('session/disposed', session => retry.disposeSession(session))
  ctx.on('tools/execute', async (exec, next) => {
    if (!isPaceShell(exec.name)) return next()
    const start = performance.now()
    const result = await next()
    retry.observe(exec, performance.now() - start, result?.value?.timedOut === true || result?.error?.info?.code === 'TOOL_TIMEOUT')
    return result
  })
  ctx.effect(() => ctx.systemPrompt.section({ name: 'dsh-pace:policy', order: 400, text: policy }))
  ctx.effect(() => ctx.tools.guard(exec => guard(exec) ?? retry.guard(exec)))
}
