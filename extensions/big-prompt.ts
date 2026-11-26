/**
 * big-prompt: /edit opens your external editor to write long prompts.
 *
 * Editor resolution:
 *   *nix:    $VISUAL, then $EDITOR, then nano/vim/vi (first found on PATH)
 *   Windows: $VISUAL, then $EDITOR, then notepad
 *
 * Flow (same as `git commit`): seeds a temp .md file with the current input
 * box text (or /edit args), blocks while the editor runs, then sends the saved
 * text as your prompt. Empty text or a non-zero editor exit aborts, nothing sent.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const isWin = process.platform === "win32";

function onPath(cmd: string): boolean {
	const probe = spawnSync(isWin ? "where" : "sh", isWin ? [cmd] : ["-c", `command -v ${cmd}`], {
		stdio: "ignore",
	});
	return probe.status === 0;
}

export function resolveEditor(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	has: (cmd: string) => boolean = onPath,
): string {
	const fromEnv = env.VISUAL?.trim() || env.EDITOR?.trim();
	if (fromEnv) return fromEnv;
	if (platform === "win32") return "notepad";
	return ["nano", "vim", "vi"].find(has) ?? "vi";
}

export function quote(path: string, platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? `"${path}"` : `'${path.replace(/'/g, `'\\''`)}'`;
}

/** Normalize editor output: CRLF to LF, drop trailing newlines. */
export function cleanText(raw: string): string {
	return raw.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("edit", {
		description: "Write and send a prompt from your $EDITOR, like git commit (empty = abort)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/edit needs the interactive TUI", "error");
				return;
			}

			const fromArgs = Boolean(args?.trim());
			const initial = fromArgs ? args.trim() : ctx.ui.getEditorText();
			const editor = resolveEditor();
			const dir = mkdtempSync(join(tmpdir(), "pi-prompt-"));
			const file = join(dir, "prompt.md");
			writeFileSync(file, initial);

			try {
				const status = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
					tui.stop();
					process.stdout.write("\x1b[2J\x1b[H");
					// shell:true so $EDITOR values with flags ("code -w", "nvim -u x") work
					const res = spawnSync(`${editor} ${quote(file)}`, {
						stdio: "inherit",
						shell: true,
						env: process.env,
					});
					tui.start();
					tui.requestRender(true);
					done(res.error ? null : res.status);
					return { render: () => [], invalidate: () => {} };
				});

				if (status === null) {
					ctx.ui.notify(`Could not launch editor: ${editor}`, "error");
					return;
				}
				if (status !== 0) {
					ctx.ui.notify(`Editor exited with code ${status}; aborting, nothing sent`, "warning");
					return;
				}

				// like `git commit`: empty message aborts, anything else goes
				const text = cleanText(readFileSync(file, "utf8"));
				if (!text.trim()) {
					ctx.ui.notify("Aborting: empty prompt", "warning");
					return;
				}
				if (!fromArgs) ctx.ui.setEditorText("");
				pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	});
}
