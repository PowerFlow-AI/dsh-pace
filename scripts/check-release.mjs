import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-pace-check-')))
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60000 }).trim()
try {
  const host = resolve(process.env.DSH_HOST_DIR || join(run('npm', ['root', '-g'], root), '@deepseek-ai/dsh'))
  const tui = resolve(process.env.DSH_TUI_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui'))
  const hostRequire = createRequire(join(host, 'package.json'))
  const fromHost = name => import(pathToFileURL(hostRequire.resolve('@deepseek-ai/' + name)))
  const parser = createRequire(join(tui, 'package.json')).resolve('@dsh-std/manifest')
  assert.equal(hash(parser), '1041a84e010c5b6924d9d921e82719a63a54ae2a697d041de24c5a32b2ae6dce', 'unreviewed manifest parser')
  assert.equal(hash(createRequire(parser).resolve('@dsh-std/core')), 'd6b5ad3cb888abe6c04782e8715bcdfdbd623d89b532849776724f124f2fc45f', 'unreviewed manifest parser dependency')
  const [pack] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], root))
  const expected = ['README.md', 'CHANGELOG.md', 'shell.js', 'LICENSE', 'index.js', 'retry.js', 'pace.test.js', 'package.json', 'cordis.patch.yml', 'dsh-plugin.json', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'scripts/check-manifest.mjs', 'scripts/check-release.mjs', 'scripts/replay.mjs']
  assert.deepEqual(pack.files.map(file => file.path).sort(), expected.sort())
  const archive = join(tmp, pack.filename)
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', tmp, archive], tmp)
  const consumer = createRequire(join(tmp, 'package.json'))
  const pkg = read(consumer.resolve(pack.name + '/package.json'))
  const { parseManifest } = await import(pathToFileURL(parser))
  const manifest = parseManifest(readFileSync(consumer.resolve(pack.name + '/dsh-plugin.json'), 'utf8'))
  assert.equal(manifest.version, pkg.version)
  const entry = consumer.resolve(pack.name)
  assert.equal(entry, resolve(tmp, 'node_modules', pack.name, manifest.facets.host.entry))
  assert.ok(readFileSync(consumer.resolve(pack.name + '/' + pkg.dsh.bundle.patch.slice(2)), 'utf8').includes("name: '" + pkg.name + "'"))
  const plugin = await import(pathToFileURL(entry))
  const { Context } = await fromHost('cordis')
  const { default: SystemPrompt } = await fromHost('dsh-system-prompt')
  const { default: Tools, defineTool } = await fromHost('dsh-tools')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools, {})
  let calls = 0
  ctx.tools.register(defineTool({
    name: 'bash', description: 'Inert release fixture; never runs a command.',
    parameters: { command: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { timedOut: { type: 'boolean', required: true } } }, render: () => [] },
    execute: async () => { calls++; return { timedOut: true } },
  }))
  const agent = { id: 'release-test', session: { id: 'release-test' } }
  let serial = 0
  const invoke = command => ctx.tools.execute({ agent, name: 'bash', arguments: { command }, callId: 'check-' + ++serial, signal: new AbortController().signal })
  const sections = async () => (await ctx.systemPrompt.assemble({ scope: agent })).sections.filter(section => section.name === 'dsh-pace:policy').length
  for (let cycle = 0; cycle < 2; cycle++) {
    const fiber = ctx.plugin(plugin)
    await fiber.await()
    assert.equal(await sections(), 1)
    const before = calls
    assert.equal((await invoke('sleep 60')).isError, true)
    assert.equal(calls, before)
    assert.equal((await invoke('rg hello .')).isError, false)
    assert.equal((await invoke('rg hello .')).isError, true)
    ctx.emit('session/disposed', agent.session)
    agent.session = { id: agent.id }
    assert.equal((await invoke('rg hello .')).isError, false)
    await fiber.dispose()
    assert.equal(await sections(), 0)
    assert.equal((await invoke('sleep 60')).isError, false)
  }
  const hostPkg = read(join(host, 'package.json'))
  const cli = (...args) => execFileSync(process.execPath, [resolve(host, hostPkg.bin.dsh), ...args], {
    cwd: tmp, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, DSH_HOME: join(tmp, 'dsh-home'), CI: 'true', npm_config_offline: 'true', NO_UPDATE_NOTIFIER: '1' },
  })
  cli('plugin', '--profile', 'pace-check', 'add', archive)
  const config = () => cli('--profile', 'pace-check', '--dump-config')
  assert.ok(config().includes('- id: dsh-pace'))
  cli('plugin', '--profile', 'pace-check', 'remove', pack.name)
  assert.ok(!config().includes('- id: dsh-pace'))
  console.log('PASS: DSH CLI install / compose / uninstall in isolated DSH_HOME')
  console.log('PASS: packed files, offline install, pinned parser/core, host attach/dispose/reload')
  if (process.env.DSH_PACE_RELEASE_DIR) {
    copyFileSync(archive, join(process.env.DSH_PACE_RELEASE_DIR, pack.filename))
  }
  console.log('Host', read(join(host, 'package.json')).version, 'TUI parser source', read(join(tui, 'package.json')).version, pack.filename, 'sha256', hash(archive))
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
