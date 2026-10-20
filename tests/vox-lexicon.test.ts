import { expect, test } from 'claude-code/testing'

import { VOX_LINES } from '../hooks/vox/lines'
import { tokenize, wordPhones } from '../hooks/vox/lexicon'

// Every distinct word of the pools with the phones it must read as. The first ten corrections beyond the rules (omnissiah and the nine words the spike heard mangled) live in the lore lexicon; the rest are what formant-tts's rules give.
const PHONES: Record<string, string> = {
  a: 'ax0',
  appeased: 'ax0 p iy1 z d',
  apply: 'ax0 p l ay1',
  are: 'aa1 r',
  awaiting: 'ax0 w ey1 t ih0 ng',
  awaits: 'ax0 w ey1 t s',
  blessing: 'b l eh1 s ih0 ng',
  caution: 'k ao1 sh ax0 n',
  command: 'k ax0 m ae1 n d',
  communion: 'k ax0 m y uw1 n y ax0 n',
  complete: 'k ax0 m p l iy1 t',
  compressed: 'k ax0 m p r eh1 s t',
  concluded: 'k ax0 n k l uw1 d ih0 d',
  consolidated: 'k ax0 n s aa1 l ih0 d ey0 t ih0 d',
  data: 'd ey1 t ax0',
  detected: 'd ih0 t eh1 k t ih0 d',
  displeased: 'd ih0 s p l iy1 z d',
  engrams: 'eh1 n g r ae0 m z',
  failed: 'f ey1 l d',
  faltered: 'f ao1 l t er0 d',
  forbidden: 'f er0 b ih1 d ax0 n',
  guidance: 'g ay1 d ax0 n s',
  has: 'h ae1 z',
  heresy: 'h eh1 r ax0 s iy0',
  is: 'ih1 z',
  link: 'l ih1 ng k',
  machine: 'm ax0 sh iy1 n',
  magos: 'm ey1 g aa0 s',
  memory: 'm eh1 m ax0 r iy0',
  noosphere: 'n uw1 ax0 s f ih0 r',
  omnissiah: 'aa0 m n ih0 s ay1 ax0',
  praise: 'p r ey1 z',
  proceed: 'p r ax0 s iy1 d',
  protects: 'p r ax0 t eh1 k t s',
  recoils: 'r ih0 k oy1 l z',
  requests: 'r ih0 k w eh1 s t s',
  required: 'r ih0 k w ay1 er0 d',
  rite: 'r ay1 t',
  sacred: 's ey1 k r ih0 d',
  sanction: 's ae1 ng k sh ax0 n',
  servitor: 's er1 v ih0 t er0',
  severed: 's eh1 v er0 d',
  silent: 's ay1 l ax0 n t',
  spirit: 's p ih1 r ih0 t',
  stacks: 's t ae1 k s',
  tech: 't eh1 k',
  the: 'dh ax0',
  this: 'dh ih1 s',
  unguents: 'ah1 ng g w ax0 n t s',
  vox: 'v aa1 k s',
  with: 'w ih1 dh',
  your: 'y ao1 r',
}

const poolWords = () => {
  const words = new Set<string>()
  for (const pool of Object.values(VOX_LINES)) {
    for (const line of pool) for (const t of tokenize(line)) if ('word' in t) words.add(t.word)
  }
  return words
}

test('the table pins exactly the words the pools use', () => {
  expect([...poolWords()].sort()).toEqual(Object.keys(PHONES).sort())
})

test('every pool word reads as pinned', () => {
  for (const w of poolWords()) expect(wordPhones(w).join(' ')).toBe(PHONES[w])
})

test('tokenize reads a hyphen as a space, so data-stacks is two words with the word gap', () => {
  const words = tokenize('The data-stacks are compressed.').flatMap((t) => ('word' in t ? [t.word] : []))
  expect(words).toEqual(['the', 'data', 'stacks', 'are', 'compressed'])
  expect(tokenize('The data-stacks are compressed.')).toEqual(tokenize('The data stacks are compressed.'))
  expect(tokenize('data - stacks')).toEqual(tokenize('data stacks'))
})

test('tokenize marks the full stop terminal and the comma not', () => {
  expect(tokenize('Heresy, Magos.')).toEqual([
    { word: 'heresy', phones: wordPhones('heresy') },
    { pause: 190 },
    { word: 'magos', phones: wordPhones('magos') },
    { pause: 330, isTerminal: true, isQuestion: false },
  ])
})

test('tokenize keeps digits, so a number reads digit by digit', () => {
  const words = tokenize('Route 66, 40k.').flatMap((t) => ('word' in t ? [t] : []))
  expect(words.map((t) => t.word)).toEqual(['route', '66', '40k'])
  expect(words[1]!.phones).toEqual(wordPhones('66'))
  expect(words[1]!.phones.length).toBeGreaterThan(2)
})
