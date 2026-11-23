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

test('Bash recognizes broad grep with quoted regexes, options and redirection', () => {
  for (const command of [
    String.raw`grep -rn "OSS_ALPHA_BUCKET_NAME\|powerx-backend-files" --include="*.py" . 2>/dev/null | head -50`,
    String.raw`grep -rn 'A\|B' .`,
    String.raw`grep -r -E "a\"b\.c" .`,
    "grep -r ' # $(text) <<end' .",
    String.raw`printf '%s\n' ready; command /usr/bin/grep -R "a\.b" "$PWD"`,
    'grep -r key ./*', 'grep -r key /*', 'grep -r key . 2>&1 | head',
  ]) assert.match(guard({ name: 'bash', arguments: { command } }), /递归搜索/, command)
})

test('Bash leaves scoped searches, stdin pipelines, literals and incomplete input alone', () => {
  for (const command of [
    String.raw`grep -rn "A\|B" src/`, String.raw`grep -n "A\|B" .`,
    String.raw`printf '%s\n' "x\"; grep -rn key .; echo \"y" | cat`,
    'printf data |& grep -rn key', 'grep -rn key src lib 2>&1 | head',
    'echo &>log grep -rn key .',
    'grep -rn key <input.txt', 'grep -r', 'grep -r key "~"', "grep -r key '$PWD/'",
    String.raw`grep -r key "\$HOME"`, 'grep -r key "./*"', 'grep -r key "*"',
    'grep -rn "unclosed .', "grep -rn key .; echo 'unclosed",
    'grep -rn key .\\', 'grep -rn key .; echo $(date)', 'grep -rn key . # comment',
    'grep -rn "' + 'x'.repeat(16_384) + '" .',
  ]) assert.equal(guard({ name: 'bash', arguments: { command } }), undefined, command.slice(0, 100))
})

test('Bash cat recognizes quoted escapes without interpreting printf text as a command', () => {
  const check = command => guard({ name: 'bash', arguments: { command } })
  assert.match(check(String.raw`printf '%s\n' start; cat $(find . -name 'a\b' -print -quit)`), /cat 失去文件参数/)
  assert.equal(check(String.raw`printf '%s\n' 'cat $(find . -name foo)'`), undefined)
  assert.equal(check(String.raw`printf '%s\n' data | cat $(find . -name foo)`), undefined)
})

test('PowerShell distinguishes regex and wildcard arguments from shell syntax', () => {
  const check = command => guard({ name: 'pwsh', arguments: { command } })
  for (const command of [
    "grep.exe -rn '(a|b)\\.js' .\\",
    'gci -Recurse | Select-String "a(b)"',
    'gci -Path "*" -Recurse | sls needle',
  ]) assert.match(check(command), /递归搜索/, command)
  for (const command of [
    "Write-Output 'it''s text; grep -rn key .'", 'grep -r "unclosed .',
    'grep -rn key "*"', 'gci -LiteralPath "*" -Recurse | sls needle',
  ]) assert.equal(check(command), undefined, command)
})

test('Bash guards the full Ollama command when cat could inherit terminal input', () => {
  const command = 'ls -la ~/.ollama/models/blobs | head -30; echo; echo "=== manifest ==="; find ~/.ollama/models/manifests -type f | head; echo; cat $(find ~/.ollama/models/manifests -type f | head -1) | head -c 2000'
  const exec = { name: 'bash', arguments: { command } }
  assert.match(guard(exec), /cat 失去文件参数/)
  assert.match(guard({ name: 'bash', arguments: { command: '/bin/cat -- $(/usr/bin/find "$HOME/a b" -type f -print -quit)' } }), /cat 失去文件参数/)
  assert.equal(guard({ ...exec, arguments: { command, run_in_background: true } }), undefined)
  assert.equal(guard({ ...exec, name: 'pwsh' }), undefined)
})

test('Bash leaves cat with explicit input and unsupported shell constructs alone', () => {
  for (const command of [
    'printf data | cat $(find . -type f -print -quit) | head',
    'printf data |& cat $(find . -type f -print -quit)',
    'cat $(find . -type f -print -quit) </dev/null | head',
    'cat "$(find . -type f -print -quit)" | head',
    'cat "$file" $(find . -type f -print -quit)',
    'cat ./$(find . -type f -print -quit)',
    'cat $(find . -type f -print -quit)suffix',
    "echo 'text; cat $(find . -type f -print -quit) | head'",
    'echo "$HOME" # ; cat $(find . -type f -print -quit)',
    'if test -d data; then echo yes; cat $(find . -type f -print -quit); fi',
    'test -n "$file" && cat $(find . -type f -print -quit)',
    'cat $(find . -type f -print -quit) &',
  ]) assert.equal(guard({ name: 'bash', arguments: { command } }), undefined, command)
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

for (const name of ['bash', 'pwsh']) {
  test(`${name}: only retries the same slow, statically quoted regex`, () => {
    const retry = createRetryPolicy()
    const exec = command => ({ name, arguments: { command }, agent: { id: 'one' } })
    const first = exec(String.raw`rg -n "a\.b|c$" .`)
    assert.equal(retry.guard(first), undefined)
    retry.observe(first, 60_000, false)
    assert.ok(retry.guard(exec(String.raw`rg 'a\.b|c$' ./`)))
    for (const command of [
      String.raw`rg 'a.b|c$' .`, String.raw`rg 'a\.b|c$' src/`,
      String.raw`rg -g '*.js' 'a\.b|c$' .`, String.raw`rg 'a\.b|c$' .; echo ok`,
      String.raw`rg 'a\.b|c$' . "`,
    ]) assert.equal(retry.guard(exec(command)), undefined, command)
    const dynamic = exec('rg "$pattern" .')
    retry.observe(dynamic, 60_000, false)
    assert.equal(retry.guard(dynamic), undefined)
  })

  test(`${name}: slow rg retries recognize Unicode keywords and the end of options`, () => {
    const retry = createRetryPolicy()
    const exec = command => ({ name, arguments: { command }, agent: { id: 'one' } })
    for (const keyword of ['节点电价', '昨日 电价', 'needle', '-i']) {
      const first = exec(`rg -n -F -- "${keyword}" .`)
      assert.equal(retry.guard(first), undefined)
      retry.observe(first, 60_000, false)
      assert.ok(retry.guard(exec(`rg -- "${keyword}" .`)))
      assert.equal(retry.guard(exec(`rg -- "${keyword}" src`)), undefined)
      assert.equal(retry.guard(exec(`rg -t js -- "${keyword}" .`)), undefined)
      assert.equal(retry.guard(exec(`rg -g "*.js" -- "${keyword}" .`)), undefined)
    }
    assert.ok(retry.guard(exec('rg 节点电价 .')))
    assert.equal(retry.guard(exec('rg -i .')), undefined)
    assert.equal(retry.guard(exec('rg -- "节点$变量" .')), undefined)
    assert.equal(retry.guard(exec('rg 其他关键词 .')), undefined)
  })
}
