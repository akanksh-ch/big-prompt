# big-prompt

Pi extension. `/edit` opens your editor to write long prompts.

- Editor: `$VISUAL`, then `$EDITOR`, then nano/vim/vi (*nix) or notepad (Windows).
- Starting text: `/edit <text>` args, else current input box text.
- On save and quit (exit 0), text goes into the input box. Press Enter to send. Nonzero exit leaves the prompt unchanged.
- GUI editors need a wait flag, e.g. `EDITOR="code -w"`.

Install: `pi install /path/to/big-prompt` or `pi -e ./extensions/big-prompt.ts`.

## Tests

`npm test` (Node 22.18+ runs the TypeScript directly, no build step).
