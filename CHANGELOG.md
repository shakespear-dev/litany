# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The desktop app on macOS and Windows: the NOOSPHERE panel draws there as the same terminal-style grid, scaled to fill the pane, and the band and voice work too.
- Sound and vox on Windows, through PowerShell.

### Fixed

- File names in the panel's rite log and the forge name on Windows paths.

## [0.2.0] - 2026-10-20

First public release.

### Added

- Themed spinner, turn line and prompt hint.
- The Noosphere band above the prompt: context, tool calls, branch, cost, 5-hour window, heresies.
- The NOOSPHERE side panel: animated art, gauges, a braille pulse of tool calls per minute, a per-tool tally, a subagent roster and the tool-call log.
- Tech-Priest voice: a short `+++ … +++` opener and closer on chat replies, never in code, commits or drafts.
- Heresy rites: warnings (never blocks) on `rm -rf`, force-push, `reset --hard` and similar.
- Seven synthesized sound clips and spoken lines in four voices, from a formant synthesizer built into the mod.
- Four themes: `mars`, `cogitator`, `forge`, `claude`.
- `/litany` to toggle any part, switch theme or voice, set volumes, open the panel, or `say` any text.

[Unreleased]: https://github.com/shakespear-dev/litany/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/shakespear-dev/litany/releases/tag/v0.2.0
