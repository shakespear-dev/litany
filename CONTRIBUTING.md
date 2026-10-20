# Contributing

All contributions welcome: bug reports, fixes, new themes, voices, lines and ideas.

## Issues

Use the bug or idea template. For a bug, include your `claude --version`, OS and terminal, and the output of `/litany`.

## Pull requests

1. Fork, branch, keep the change focused on one thing.
2. Run the checks:

   ```sh
   claude plugin validate .
   claude plugin test .
   ```

3. If it changes what you see or hear, try it in a real session: `claude --plugin-dir .`

CI runs the same two checks on every PR, on Claude Code 2.1.304 and on the latest release, plus shellcheck and a check that `script/make-sounds.py` still rebuilds `sounds/` byte for byte.

## AI-assisted changes

Welcome. Write the code with whatever tools you like, as long as you understand every line you submit and can answer questions about it. "The AI wrote it" is not an answer in review.

## Keep the description short

A few lines are enough: what changed, why, how you tested it. No essays and no generated walls of text. If the description is longer than the diff, cut it.

## Fan-work rules

This is a free, non-commercial fan project. Don't add Games Workshop artwork, logos, audio, or text copied from their books and codexes, and don't add anything that makes money (ads, paid tiers, donation links). Original art, sounds and lines in the spirit of the setting are great.

## Code of conduct

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
