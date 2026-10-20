import type { SoundEvent } from '../../types'

// What the mod says on each sound event. One pool per event; English whatever the person writes in.
export const VOX_LINES: Readonly<Record<SoundEvent, readonly string[]>> = {
  'rite-done': ['Rite concluded.', 'Praise the Omnissiah.', 'The Machine Spirit is appeased.', 'The Omnissiah protects.', 'The rite is complete.'],
  heresy: ['Tech heresy detected.', 'Heresy. Proceed with caution, Magos.', 'This rite is forbidden.', 'The Machine Spirit recoils.'],
  displeased: ['The Machine Spirit is displeased.', 'The rite has faltered.', 'Apply the sacred unguents.'],
  sanction: ['Your sanction is required, Magos.', 'The rite awaits your blessing.', 'Awaiting your command, Magos.'],
  severed: ['Noosphere link severed.', 'The vox is silent.', 'Communion with the Noosphere has failed.'],
  servitor: ['A servitor awaits your command.', 'A servitor requests guidance.'],
  engrams: ['Memory engrams consolidated.', 'The data-stacks are compressed.'],
}
