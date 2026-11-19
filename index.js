import { createRetryPolicy } from './retry.js'

export const name = 'dsh-pace'
export const inject = ['systemPrompt', 'tools']

const policy = `## Pace：让下一步尽快可见
先回答用户要判断的事；侦查先查已知文件，再按目录、类型扩展。优先 rg / 工作区搜索；rg --hidden 从根目录扫也可能很慢。不要把 head 当作搜索超时。
慢任务先报启动状态。job_output 先用 wait:false 查看现状；确需等时用 wait:true、timeout_ms:5000，不连续轮询，保留作业等完成通知。一次查不到就报告已知事实和下一步。长命令按可验证的步骤拆开；复杂脚本用文件，保留必要的事务与清理。`

const searchHint = 'Pace：递归 grep 范围过大。先用 rg -n -F -- "字面量" 具体目录/；查正则时去掉 -F，并按需要用 -g 限定文件类型。'
const waitHint = 'Pace：不要在前台先空等一分钟再查。现在先查看进程、日志或作业状态；必要时短等后再查。'

function broadGrep(words, piped) {
  if (!/^(?:.*\/)?grep$/.test(words[0])) return false
  let recursive = false, pattern = false, options = true
  const paths = []
  for (let index = 1; index < words.length; index++) {
    const word = words[index]
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
    else paths.push(word)
  }
  return recursive && ((!paths.length && !piped) || paths.length >= 4 || paths.some(path => /^(?:\.|\.\.|~|\$PWD|\$HOME|\*)\/?$/.test(path) || path === '/'))
}

export function guard(execution) {
  const cmd = execution?.arguments?.command
  if (execution?.name !== 'bash' || typeof cmd !== 'string') return
  const sleep = cmd.match(/^\s*(?:\/bin\/)?sleep\s+(\d+(?:\.\d+)?)([smh]?)\s*(?:$|;|&&)/)
  if (sleep && execution.arguments.run_in_background !== true) {
    const [, amount, unit] = sleep
    if (Number(amount) * ({ m: 60, h: 3600 }[unit] ?? 1) >= 60) return waitHint
  }
  if (/[`\\\n]|<<|\$\(|(?:^|\s)#/.test(cmd)) return
  const tokens = cmd.match(/\d*>\s*\/dev\/null(?=\s|[;|&]|$)|(?:'[^']*'|"[^"]*"|[^\s;&|'"<>])+|&&|\|\||[;|&]|[^\s]/g) ?? []
  let words = [], piped = false
  for (const token of [...tokens, ';']) {
    if ([';', '|', '&', '&&', '||'].includes(token)) {
      while (['time', 'command', 'sudo', 'nohup', 'env'].includes(words[0]) || /^\w+=/.test(words[0] ?? '')) words.shift()
      if (broadGrep(words, piped)) return searchHint
      words = []; piped = token === '|'
    } else if (!/^\d*>\s*\/dev\/null$/.test(token)) {
      words.push(token === '"*"' || /^'(?:\*|\$PWD|\$HOME|~)'$/.test(token) ? '<literal>' : token.replace(/['"]/g, ''))
    }
  }
}

export function apply(ctx) {
  const retry = createRetryPolicy()
  ctx.on('session/disposed', session => retry.disposeSession(session))
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name !== 'bash') return next()
    const start = performance.now()
    const result = await next()
    retry.observe(exec, performance.now() - start, result?.value?.timedOut === true || result?.error?.info?.code === 'TOOL_TIMEOUT')
    return result
  })
  ctx.effect(() => ctx.systemPrompt.section({ name: 'dsh-pace:policy', order: 400, text: policy }))
  ctx.effect(() => ctx.tools.guard(exec => guard(exec) ?? retry.guard(exec)))
}
