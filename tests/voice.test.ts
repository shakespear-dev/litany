import { expect, mock, test } from 'claude-code/testing'

import { ignitionText } from '../hooks/lore'

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

test('voice adds one session section only while on', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'core', text: 'x', scope: 'shared' }] }))
  const r = await $.prompt.compose(COMPOSE)
  expect(r.sections.map(s => s.id)).toEqual(['core', 'litany-voice'])
  expect(r.sections[1]?.scope).toBe('session')
  expect(r.sections[1]?.text).toMatch(/Never apply the theme to code/)

  await $.command.run({ command: 'litany', args: 'voice off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const off = await $.prompt.compose(COMPOSE)
  expect(off.sections.map(s => s.id)).toEqual(['core'])
})

test('voice respects the config default', { options: { voice: false } }, async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([])
})

test('voice stays out of headless and SDK prompts', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  expect((await $.prompt.compose({ ...COMPOSE, surfaces: [], traits: ['print'] })).sections).toEqual([])
  expect((await $.prompt.compose({ ...COMPOSE, traits: ['sdk-preset'] })).sections).toEqual([])
})

test('the desktop app gets the voice although it hosts through the SDK; a teammate or --bare never does', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const desktop = { ...COMPOSE, surfaces: ['desktop'], traits: ['print', 'sdk-preset'] } as const
  expect((await $.prompt.compose(desktop)).sections.map(s => s.id)).toEqual(['litany-voice'])
  expect((await $.prompt.compose({ ...desktop, traits: ['teammate'] })).sections).toEqual([])
  expect((await $.prompt.compose({ ...desktop, traits: ['bare'] })).sections).toEqual([])
})

test('ignitionText names the forge and branch when known', () => {
  expect(ignitionText('my-projects', 'main')).toBe(
    '+++ Litany of Ignition +++ Cogitator awakened. Forge: my-projects @ main. The Omnissiah protects.',
  )
  expect(ignitionText()).toBe('+++ Litany of Ignition +++ Cogitator awakened. The Omnissiah protects.')
})

test('the Litany of Ignition is said once, even when a reload re-runs session.start', async ($, on) => {
  const session = mock.session(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.repo', () => ({ value: { root: '/x/my-projects', remote: null, internal: false, name: 'my-projects' } }))
  const start = { cwd: '/x/my-projects', surface: 'terminal', isInteractive: true } as const
  await $.session.start(start)
  await $.session.start(start)

  const notes = session.appended().filter(r => r.door === 'note')
  expect(notes.length).toBe(1)
  expect(JSON.stringify(notes[0]?.message.content)).toMatch(/Litany of Ignition.*Forge: my-projects/)
})

test('headless runs get no Litany of Ignition', async ($, on) => {
  const session = mock.session(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.repo', () => ({ value: null }))
  await $.session.start({ cwd: '/x/my-projects', surface: null, isInteractive: false })
  expect(session.appended().filter(r => r.door === 'note').length).toBe(0)
})
