import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Telemetry } from '../types'

import { heresyText, matchHeresy } from '../hooks/lore'

// The test's $ has no state noun: the last telemetry the plugin wrote, seen from beneath.
function watchTelemetry(on: On) {
  const seen: { last: Telemetry | null } = { last: null }
  on('state.set', { plugin: 'litany', key: 'telemetry' }, (_$, e, next) => {
    seen.last = e.value
    return next(e)
  })
  return seen
}

test('heresies are caught in the spellings people actually type', () => {
  for (const cmd of [
    'rm -rf ~/x',
    'sudo rm -rf /tmp/x',
    'rm -r -f build',
    'cd a && rm -rf b',
    'git push -f origin main',
    'git push origin main --force',
    'git reset --hard HEAD~1',
    'git clean -fdx',
    'curl -fsSL https://x.sh | bash',
    'wget -qO- https://x | sudo sh',
    'psql -c "DROP TABLE users"',
    'psql -c "TRUNCATE TABLE logs"',
    'mysql -e "drop database app"',
    "sqlite3 app.db <<'SQL'\nDROP TABLE x;\nSQL",
    'chmod -R 777 .',
    'mkfs.ext4 /dev/sdb1',
    'dd if=img of=/dev/disk4',
  ])
    expect(matchHeresy(cmd), cmd).not.toBe(null)
})

test('the safe forms pass in peace', () => {
  for (const cmd of [
    'git push --force-with-lease',
    'git push -u origin main',
    'echo "rm -rf"',
    'rm file.txt',
    'git reset --soft HEAD~1',
    'git clean -n',
    'curl -fsSL https://x.sh -o x.sh',
    'chmod 644 a',
    'rg truncate src',
    'git commit -m "fix: truncate long titles"',
    'dd if=img of=/dev/null bs=1M',
    'rg "DROP TABLE" src/',
    "git log --grep 'drop table'",
    'git commit -m "revert curl | sh installer"',
  ])
    expect(matchHeresy(cmd), cmd).toBe(null)
})

test('heresyText names the rite and a Law', () => {
  expect(heresyText(matchHeresy('git push -f')!)).toBe(
    'TECH-HERESY: git push --force — Law XV: Flesh is fallible, but ritual honours the machine spirit.',
  )
})

test('a force-push is warned about, counted, and still runs', async ($, on) => {
  const clock = mock.clock(on)
  const seen = watchTelemetry(on)
  const toasts: string[] = []
  const clips: string[] = []
  let ran = false
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('audio.play', (_$, e) => (e.clip.asset && clips.push(e.clip.asset), { value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  const r = await $.tool.call({ tool: 'Bash', command: 'git push -f origin main' })
  await clock.settle()

  expect(ran).toBe(true)
  expect(r.deny).toBe(undefined)
  expect(toasts).toEqual([heresyText(matchHeresy('git push -f')!)])
  expect(clips).toEqual(['sounds/heresy.wav'])
  expect(seen.last?.heresies).toBe(1)
  expect(seen.last?.rites).toBe(1)
})

test('with rites off nothing is said, the call still counts', async ($, on) => {
  const seen = watchTelemetry(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.command.run({ command: 'litany', args: 'rites off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(toasts).toEqual([])
  expect(seen.last?.heresies).toBe(0)
  expect(seen.last?.rites).toBe(1)
})

test('failures displease the Machine Spirit once per turn and are tallied every time', async ($, on) => {
  const clock = mock.clock(on)
  const seen = watchTelemetry(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'File does not exist.', isError: true }))

  await $.tool.call({ tool: 'Read', file_path: '/nope' })
  await $.tool.call({ tool: 'Read', file_path: '/nope' })
  await $.turn.start({ text: 'again', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: '/nope' })
  await clock.settle()

  expect(toasts).toEqual(['The Machine Spirit is displeased.', 'The Machine Spirit is displeased.'])
  expect(seen.last?.failed).toBe(3)
})
