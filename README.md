# big-prompt

Pi extension. `/edit` opens your editor to write long prompts.

- Editor: `$VISUAL`, then `$EDITOR`, then nano/vim/vi (*nix) or notepad (Windows).
- Works like `git commit`: write the prompt, save and quit, and it is sent. Empty text or a non-zero editor exit (`:cq`) aborts and sends nothing.
- Starting text: `/edit <text>` args, else current input box text.
- If the agent is busy, the prompt is queued as a follow-up.
- Lines starting with `#` are kept (markdown headings), unlike git.
- GUI editors need a wait flag, e.g. `EDITOR="code -w"`.

Install: `pi install /path/to/big-prompt` or `pi -e ./extensions/big-prompt.ts`.

## Tests

`npm test` (Node 22.18+ runs the TypeScript directly, no build step).
