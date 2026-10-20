import { expect, test } from 'claude-code/testing'

import { formatDuration, spinnerWord, toolPhrase, turnLine } from '../hooks/lore'

test('toolPhrase picks the pool for each kind of tool', () => {
  expect(toolPhrase('Bash', 0)).toBe('Anointing the cogitator')
  expect(toolPhrase('Bash', 1)).toBe('Intoning the Litany of Ignition')
  expect(toolPhrase('Grep', 0)).toBe('Sifting the Librarium data-stacks')
  expect(toolPhrase('Write', 0)).toBe('Inscribing the sacred code-scrolls')
  expect(toolPhrase('Agent', 0)).toBe('Dispatching a servitor')
  expect(toolPhrase('mcp__parallel__web_search', 3)).toBe('Querying the astropathic relay')
  expect(toolPhrase('mcp__linear-server__get_issue', 0)).toBe('Petitioning the forge-shrine linear-server')
  expect(toolPhrase('SomethingNew', 0)).toBe('Consulting the Noosphere')
})

test('spinnerWord uses the tool phrase only while a tool runs', () => {
  const bash = { name: 'Bash', phrase: 'Anointing the cogitator' }
  expect(spinnerWord('tool-use', bash, 0)).toBe('Anointing the cogitator')
  expect(spinnerWord('thinking', bash, 1)).toBe('Communing with the Machine Spirit')
  expect(spinnerWord('responding', null, 0)).toBe('Transcribing binharic canticles')
  expect(spinnerWord('tool-use', null, 0)).toBe('Consulting the Noosphere')
})

test('formatDuration and turnLine read like the engine line', () => {
  expect(formatDuration(3_400)).toBe('3s')
  expect(formatDuration(64_000)).toBe('1m 4s')
  expect(formatDuration(3_725_000)).toBe('1h 2m')
  expect(turnLine(3_000)).toBe('⚙ Rite concluded in 3s')
  expect(turnLine(64_000)).toBe('⚙ Canticle sung for 1m 4s')
  expect(turnLine(5_000)).toBe('⚙ Machine Spirit appeased in 5s')
})

const SPINNER = { component: 'Spinner', requestId: 'main', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' } } as const

test('spinner speaks Mechanicus while thinking and stays stock when switched off', async ($, on) => {
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.word}</Text>
  })
  let ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...SPINNER })
  expect(await ui.find({ type: 'Text', text: 'Consulting the Noosphere' })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'litany', args: 'spinner off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...SPINNER })
  expect(await ui.find({ type: 'Text', text: 'Sauteing' })).toBeDefined()
  await ui.unmount()
})

test('footer shows the litany label until everything is off', async ($, on) => {
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.modes.join(' & ') || '(none)'}</Text>
  })
  const MODE = { component: 'SessionMode', requestId: 'mode', props: { modes: ['focus'] } } as const
  let ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...MODE })
  expect(await ui.find({ type: 'Text', text: 'focus & ⚙ litany' })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'litany', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  ui = await $.ui.mount({ plugin: 'litany', surface: 'terminal', ...MODE })
  expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await ui.unmount()
})

test('the desktop keeps its own spinner words', async ($, on) => {
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.word}</Text>
  })
  const ui = await $.ui.mount({ plugin: 'litany', surface: 'desktop', ...SPINNER })
  expect(await ui.find({ type: 'Text', text: 'Sauteing' })).toBeDefined()
  await ui.unmount()
})
