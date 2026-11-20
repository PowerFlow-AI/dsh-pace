import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, guard } from './index.js'
import { createRetryPolicy } from './retry.js'

for (const command of ['grep -rn foo .', 'command /usr/bin/grep -R -e foo "."', 'grep -R foo -n --exclude-dir=.git . | head', 'grep -RIn --exclude-dir=.git --exclude="*.pyc" -E "a|b" one two three four 2>/dev/null | head -100', 'sleep 60; pid=$(date); echo "$pid"', 'sleep 1m && echo ready']) {
  test(`denies ${command}`, () => assert.equal(typeof guard({ name: 'bash', arguments: { command } }), 'string'))
}
for (const command of ['grep -R -e foo scripts/', 'grep -rn foo src/ 2>/dev/null', 'grep -n foo .', 'git grep foo', 'echo "x; grep -rn foo ."', 'echo foo | grep -r foo', 'grep -rn foo "*"', 'rg --hidden foo .', 'sleep 59; ps', 'sleep 120 &', "cat <<'END'\ngrep -rn foo .\nEND", 'echo ' + 'x'.repeat(5000)]) {
  test(`allows ${command.slice(0, 70)}`, () => assert.equal(guard({ name: 'bash', arguments: { command } }), undefined))
}
test('registers via effects and leaves other tools alone', () => {
  const registered = []
  const hooks = {}
  apply({ on: (key, fn) => { hooks[key] = fn }, effect: callback => callback(), systemPrompt: { section: value => registered.push(value.name) }, tools: { guard: value => registered.push(value) } })
  assert.equal(registered[0], 'dsh-pace:policy')
  assert.equal(typeof hooks['tools/execute'], 'function')
  assert.equal(guard({ name: 'grep', arguments: { command: 'sleep 60' } }), undefined)
  assert.equal(guard({ name: 'bash' }), undefined)
})

test('slow retry is session-local, bypassed by narrowing, and expires', () => {
  let time = 0
  const retry = createRetryPolicy(() => time)
  const exec = (command, id = 'one') => ({ name: 'bash', arguments: { command }, agent: { id } })
  const first = exec("cd /repo && time rg --hidden -g '!data/**' foo . | wc -l")
  retry.observe(first, 100, false)
  assert.equal(retry.guard(first), undefined)
  retry.observe(first, 60000, false)
  assert.ok(retry.guard(exec('cd /repo && rg foo .')))
  for (const cmd of ['cd /repo && rg foo src/', 'cd /repo && rg foo -t py', 'cd /repo && rg -g "*.js" foo .', 'cd /repo && rg bar .', 'cd /else && rg foo .']) assert.equal(retry.guard(exec(cmd)), undefined)
  assert.equal(retry.guard(exec(first.arguments.command, 'two')), undefined)
  time = 900000
  assert.equal(retry.guard(first), undefined)
  retry.observe(first, 12, true)
  assert.ok(retry.guard(first))
})

test('disposal clears only that session and ignores its late results after resume', () => {
  const retry = createRetryPolicy()
  const make = id => ({ name: 'bash', arguments: { command: 'rg hello .' }, agent: { id, session: { id } } })
  const first = make('one'), other = make('two'), resumed = make('one')
  retry.observe(first, 61000, false)
  retry.observe(other, 61000, false)
  retry.disposeSession(first.agent.session)
  retry.observe(first, 61000, false)
  assert.equal(retry.guard(resumed), undefined)
  assert.ok(retry.guard(other))
  retry.observe(resumed, 61000, false)
  assert.ok(retry.guard(resumed))
})

test('host middleware passes through results and guards only the matching foreground workdir', async () => {
  let around, check
  apply({ on: (_, fn) => { around = fn }, effect: fn => fn(), systemPrompt: { section() {} }, tools: { guard: fn => { check = fn } } })
  const exec = { agent: { id: 'a' }, name: 'bash', arguments: { command: 'rg foo .', workdir: '/one' } }
  const timeout = { isError: false, value: { timedOut: true } }
  assert.equal(await around(exec, async () => timeout), timeout)
  assert.ok(check(exec))
  for (const args of [{ workdir: '/two' }, { run_in_background: true }, { command: 'sleep 90', run_in_background: true }]) assert.equal(check({ ...exec, arguments: { ...exec.arguments, ...args } }), undefined)
  assert.equal(check({ name: 'job_output', arguments: { wait: true, timeout_ms: 180000 } }), undefined)
})

test('pwsh recognizes broad searches and long foreground waits', () => {
  for (const command of [
    'grep -Rn key .', 'C:\\bin\\GREP.EXE -r key .\\', 'grep -r key a b c d',
    'Get-ChildItem -Path .\\ -File -Recurse | Select-String key',
    'gci -recurse | sls key', 'sleep 60', 'START-SLEEP -Seconds 60; Get-Process',
    'Start-Sleep -Milliseconds 60000', 'Start-Sleep -ms 60000', 'sleep 60\r\nGet-Process',
  ]) assert.ok(guard({ name: 'pwsh', arguments: { command } }), command)
})

test('pwsh leaves scoped searches, literal text, scripts and short or background sleeps alone', () => {
  for (const command of [
    'grep -Rn key .\\src', 'grep -Rn key .\\src 2>$null', 'grep -n key .',
    'Get-ChildItem -Recurse src | Select-String key',
    'gci -Filter *.js -Recurse | sls key', 'gci -Recurse | Select-Object Name',
    'Get-Item src | gci -Recurse | sls key',
    'Write-Output "a; grep -Rn key .; sleep 60"', "'Start-Sleep 60'", 'Write-Output ok # grep -Rn key .',
    "Get-Job | ForEach-Object { grep -Rn key . }", "@'\ngrep -Rn key .\n'@",
    'Start-Sleep -Milliseconds 59999', 'sleep 59', 'Start-Sleep 120 &', 'Start-Sleep $seconds',
  ]) assert.equal(guard({ name: 'pwsh', arguments: { command } }), undefined, command)
  assert.equal(guard({ name: 'pwsh', arguments: { command: 'Start-Sleep 60', run_in_background: true } }), undefined)
})

test('pwsh slow searches use the foreground session, directory, keyword and expiry', () => {
  let now = 0
  const retry = createRetryPolicy(() => now)
  const exec = (command, args) => ({ name: 'pwsh', agent: { id: 'a' }, arguments: { command, workdir: 'C:\\repo', ...args } })
  const search = exec('C:\\bin\\RG.EXE --hidden needle .\\')
  retry.observe(search, 59_999, false)
  assert.equal(retry.guard(search), undefined)
  retry.observe(search, 60_000, false)
  assert.ok(retry.guard(exec('rg needle')))
  for (const command of ['rg needle .\\src', 'rg needle -t js', 'rg -g "*.js" needle .', 'rg different .', "Write-Output 'rg needle .'"]) {
    assert.equal(retry.guard(exec(command)), undefined, command)
  }
  assert.equal(retry.guard(exec('rg needle .', { workdir: 'D:\\repo' })), undefined)
  assert.equal(retry.guard(exec('rg needle .', { run_in_background: true })), undefined)
  now = 900_000
  assert.equal(retry.guard(search), undefined)
})
