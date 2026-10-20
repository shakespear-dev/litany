// Dev only, never imported by the mod: renders every pool line in every voice to WAV, as `speak` plays it, plus three more takes of each, and lines.tsv (id, text), to listen to with script/vox-listen.sh next to the spike's renders.
//   bun script/vox-render.ts <out dir> [voice]
// <voice>-<event>-<n>.wav is take 1, the parity take; takes/<voice>-<event>-<n>.take<k>.wav use the spike's take seeds, so each file has the spike's own twin.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { VOX_LINES } from '../hooks/vox/lines'
import { speak, VOICE_NAMES, type VoiceName } from '../hooks/vox/voices'

const [outDir, only] = process.argv.slice(2)
if (!outDir || (only && !VOICE_NAMES.includes(only as VoiceName))) {
  console.error(`usage: bun script/vox-render.ts <out dir> [${VOICE_NAMES.join('|')}]`)
  process.exit(1)
}
const lines = Object.entries(VOX_LINES).flatMap(([event, pool]) => pool.map((text, i) => [`${event}-${i + 1}`, text] as const))
// spike.js: n * 7919 plus the id's FNV-1a hash.
const takeSeed = (id: string, n: number) => n * 7919 + [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)

mkdirSync(join(outDir, 'takes'), { recursive: true })
writeFileSync(join(outDir, 'lines.tsv'), lines.map(([id, text]) => `${id}\t${text}\n`).join(''))
for (const voice of VOICE_NAMES) {
  if (only && voice !== only) continue
  for (const [id, text] of lines) {
    writeFileSync(join(outDir, `${voice}-${id}.wav`), speak(voice, text, 1).wav)
    for (const n of [1, 2, 3]) writeFileSync(join(outDir, 'takes', `${voice}-${id}.take${n}.wav`), speak(voice, text, takeSeed(id, n)).wav)
  }
}
console.log(`${outDir}: ${lines.length} lines and 3 takes each in ${only ?? VOICE_NAMES.join(', ')}`)
