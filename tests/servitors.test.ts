import { expect, test } from 'claude-code/testing'

import { elapsed, KEEP_FINISHED, ranRite, roster, spawned, turnEnded, turnStarted } from '../hooks/servitors'

const SPAWN = { subagentType: 'Explore', description: 'find the pane API', prompt: 'Find where the pane API lives.' }
const as = (description: string) => ({ ...SPAWN, description })

test('a spawn records the type, the description, the start and no rites', () => {
  expect(spawned({}, 'a1', SPAWN, 1000)).toEqual({ a1: { type: 'Explore', description: 'find the pane API', startedAt: 1000, rites: 0 } })
})

test("a workflow agent is typed workflow and described by its prompt's first words", () => {
  const a = spawned({}, 'w1', { ...SPAWN, description: 'ignored by the engine', prompt: 'Review the changed files\nfor bugs and report each one', workflow: { runId: 'wf_1', agentIndex: 1 } }, 0)
  expect(a.w1).toEqual({ type: 'workflow', description: 'Review the changed files for bugs', startedAt: 0, rites: 0 })
})

test("rites count for recorded agents only; a turn's end and a new start move the lamp", () => {
  let a: ReturnType<typeof spawned> = spawned({}, 'a1', SPAWN, 1000)
  a = { ...ranRite(ranRite(a, 'a1'), 'a1') }
  const same = ranRite(a, 'fork-1')
  expect(same).toBe(a)
  const ended = turnEnded(a, 'a1', 5000, false)
  expect(ended.a1).toEqual({ type: 'Explore', description: 'find the pane API', startedAt: 1000, rites: 2, endedAt: 5000, ok: false })
  expect(turnStarted(ended, 'a1', 9000).a1).toEqual({ type: 'Explore', description: 'find the pane API', startedAt: 9000, rites: 2 })
  expect(turnEnded(ended, 'nobody', 1, true)).toBe(ended)
  expect(turnStarted(ended, 'nobody', 1)).toBe(ended)
})

test('a resumed spawn keeps the record and goes live again with a fresh clock', () => {
  const done = turnEnded(ranRite(spawned({}, 'a1', SPAWN, 0), 'a1'), 'a1', 10, true)
  expect(spawned(done, 'a1', { subagentType: 'Explore', description: '', prompt: '' }, 20).a1).toEqual({ type: 'Explore', description: 'find the pane API', startedAt: 20, rites: 1 })
})

test('only the newest 30 finished agents are kept; live ones always stay', () => {
  let a: ReturnType<typeof spawned> = spawned({}, 'live', SPAWN, 0)
  for (let i = 0; i < 35; i++) a = { ...turnEnded(spawned(a, `d${i}`, SPAWN, i), `d${i}`, 100 + i, true) }
  expect(Object.keys(a).length).toBe(KEEP_FINISHED + 1)
  expect(a.live).toBeDefined()
  expect(a.d4).toBeUndefined()
  expect(a.d5).toBeDefined()
})

test('the roster lists live agents oldest first, then those finished within a minute, newest first', () => {
  let a: ReturnType<typeof spawned> = spawned({}, 'old', as('old'), 0)
  a = spawned(a, 'new', as('new'), 50)
  a = { ...turnEnded(spawned(a, 'gone', as('gone'), 0), 'gone', 1000, true) }
  a = { ...turnEnded(spawned(a, 'fresh', as('fresh'), 0), 'fresh', 30_000, true) }
  a = { ...turnEnded(spawned(a, 'fresher', as('fresher'), 0), 'fresher', 40_000, false) }
  expect(roster(a, 61_000).map(s => s.description)).toEqual(['old', 'new', 'fresher', 'fresh'])
  expect(roster({}, 0)).toEqual([])
})

test('elapsed reads m:ss, and h:mm:ss from an hour', () => {
  expect(elapsed(42_000)).toBe('0:42')
  expect(elapsed(70_500)).toBe('1:10')
  expect(elapsed(3_725_000)).toBe('1:02:05')
  expect(elapsed(-5)).toBe('0:00')
})
