export type Switch = 'spinner' | 'turnline' | 'hint' | 'band' | 'voice' | 'rites' | 'sound' | 'panel' | 'pulse' | 'spirits' | 'roster' | 'sublog' | 'split'
// The seven events that sound a clip and, with vox on, speak a line.
export type SoundEvent = 'rite-done' | 'heresy' | 'displeased' | 'sanction' | 'severed' | 'servitor' | 'engrams'
export type VoxSetting = 'default' | 'mars' | 'cogitator' | 'forge' | 'claude' | 'off'
export type Volumes = { master: number; beeps: number; vox: number }
// `agent`: the servitor's type when a servitor made the call (`fork` for an id no spawn recorded); absent for the main loop.
export type RiteEntry = { tool: string; label: string; ok: boolean; agent?: string }
export type HeresyEntry = { at: number; command: string }
export type Overrides = { master: boolean | null; switches: Partial<Record<Switch, boolean>> }
export type ActiveTool = { name: string; phrase: string }
// Rites per minute: `counts` ends at minute `last` (minutes since the epoch of $.clock.now()).
export type Pulse = { last: number; counts: number[] }
// One agent other than the main loop, by its agent id. No `endedAt`: it is live.
export type Servitor = { type: string; description: string; startedAt: number; endedAt?: number; ok?: boolean; rites: number }
export type Telemetry = {
  forge?: string
  contextPct?: number
  costUsd?: number
  fiveHourPct?: number
  branch?: string
  rites: number
  failed: number
  heresies: number
}

declare module 'claude-code' {
  interface PluginState {
    litany: {
      overrides: Overrides
      tool: ActiveTool | null
      law: number
      telemetry: Telemetry
      heresyLine: string | null
      failedThisTurn: boolean
      ignited: boolean
      riteLog: RiteEntry[]
      heresyLog: HeresyEntry[]
      pulse: Pulse
      spirits: Record<string, number>
      agents: Record<string, Servitor>
      servitorPulse: Pulse
      panelOpen: boolean | null
      themeOverride: string | null
      voxOverride: VoxSetting | null
      volumeOverride: Partial<Volumes>
    }
  }
}
