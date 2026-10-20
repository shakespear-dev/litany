import { expect, test } from 'claude-code/testing'

import { parseCommand, pickLine, resolveVolumes, resolveVox, volumeGain } from '../hooks/lore'
import { VOX_LINES } from '../hooks/vox/lines'
import type { SoundEvent } from '../types'

test('resolveVox follows the theme on default and ignores it for a named voice', () => {
  expect(resolveVox({}, null, 'forge', null)).toBe('forge')
  expect(resolveVox({ vox: 'claude' }, null, 'mars', null)).toBe('claude')
  expect(resolveVox({ vox: 'claude' }, 'default', 'cogitator', null)).toBe('cogitator')
  expect(resolveVox({}, 'forge', 'mars', null)).toBe('forge')
})

test('vox off and master off are silent', () => {
  expect(resolveVox({}, 'off', 'mars', null)).toBe(null)
  expect(resolveVox({ vox: 'off' }, null, 'mars', null)).toBe(null)
  expect(resolveVox({}, 'forge', 'mars', false)).toBe(null)
  expect(resolveVox({}, null, 'mars', true)).toBe('mars')
})

test('a stored vox outside the options reads as default', () => {
  for (const bad of ['Mars', '', 42]) expect(resolveVox({ vox: bad }, null, 'forge', null)).toBe('forge')
})

test('volumes multiply and map to amplitude as the square', () => {
  expect(volumeGain(5, 5)).toBe(0.0625)
  expect(volumeGain(5, 10)).toBe(0.25)
  expect(volumeGain(10, 10)).toBe(1)
  expect(volumeGain(0, 10)).toBe(0)
})

test('stored volumes outside "0"…"10" read as 10', () => {
  for (const bad of ['11', 'loud', 7, '-1']) expect(resolveVolumes({ volumeMaster: bad, volumeBeeps: bad, volumeVox: bad }, {})).toEqual({ master: 10, beeps: 10, vox: 10 })
  expect(resolveVolumes({ volumeMaster: '3', volumeBeeps: '0', volumeVox: '10' }, {})).toEqual({ master: 3, beeps: 0, vox: 10 })
  expect(resolveVolumes({ volumeMaster: '3' }, { master: 6, vox: 2 })).toEqual({ master: 6, beeps: 10, vox: 2 })
})

test('pickLine never repeats the last line', () => {
  for (const [event, pool] of Object.entries(VOX_LINES) as [SoundEvent, readonly string[]][]) {
    if (pool.length < 2) continue
    for (let i = 0; i < 100; i++) {
      const last = pool[i % pool.length]
      expect(pickLine(event, last, i / 100)).not.toBe(last)
      expect(pool).toContain(pickLine(event, last, i / 100))
    }
  }
  expect(VOX_LINES['rite-done']).toContain(pickLine('rite-done', undefined, 0.5))
})

test('parseCommand reads vox and volume', () => {
  expect(parseCommand('vox forge')).toEqual({ kind: 'vox', setting: 'forge' })
  expect(parseCommand('vox on')).toEqual({ kind: 'vox', setting: 'default' })
  expect(parseCommand('vox off')).toEqual({ kind: 'vox', setting: 'off' })
  expect(parseCommand('vox loud').kind).toBe('error')
  expect(parseCommand('volume master 5')).toEqual({ kind: 'volume', which: 'master', level: 5 })
  expect(parseCommand('volume')).toEqual({ kind: 'volumes' })
  expect(parseCommand('volume beeps 11').kind).toBe('error')
  expect(parseCommand('volume beeps 1.5').kind).toBe('error')
  expect(parseCommand('volume loud 5').kind).toBe('error')
})
