import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import bigPrompt, { cleanText, quote, resolveEditor } from "../extensions/big-prompt.ts";

test("resolveEditor: VISUAL beats EDITOR", () => {
	assert.equal(resolveEditor({ VISUAL: "hx", EDITOR: "nano" }, "linux"), "hx");
});
test("resolveEditor: EDITOR used when no VISUAL; blank VISUAL ignored", () => {
	assert.equal(resolveEditor({ EDITOR: "nvim" }, "linux"), "nvim");
	assert.equal(resolveEditor({ VISUAL: "  ", EDITOR: "nvim" }, "linux"), "nvim");
});
test("resolveEditor: keeps flags", () => {
	assert.equal(resolveEditor({ EDITOR: "code -w" }, "linux"), "code -w");
});
test("resolveEditor: windows falls back to notepad", () => {
	assert.equal(resolveEditor({}, "win32"), "notepad");
});
test("resolveEditor: *nix fallback picks first on PATH, else vi", () => {
	assert.equal(resolveEditor({}, "linux", (c) => c === "vim"), "vim");
	assert.equal(resolveEditor({}, "linux", () => false), "vi");
});

test("quote: posix single quotes, escapes embedded quote", () => {
	assert.equal(quote("/tmp/a b/p.md", "linux"), "'/tmp/a b/p.md'");
	assert.equal(quote("/tmp/it's", "linux"), `'/tmp/it'\\''s'`);
});
test("quote: windows double quotes", () => {
	assert.equal(quote("C:\\Temp\\p.md", "win32"), '"C:\\Temp\\p.md"');
});

test("cleanText: CRLF to LF, trailing newlines dropped, inner blank lines kept", () => {
	assert.equal(cleanText("a\r\n\r\nb\r\n\r\n"), "a\n\nb");
});

// --- end-to-end through the registered command, with a fake pi/ctx and a real editor script ---

function setup(editorScript: string, initialBox = "") {
	const dir = mkdtempSync(join(tmpdir(), "bp-test-"));
	const ed = join(dir, "ed.sh");
	writeFileSync(ed, `#!/bin/sh\n${editorScript}\n`);
	chmodSync(ed, 0o755);
	process.env.EDITOR = ed;
	delete process.env.VISUAL;

	let handler: (args: string, ctx: any) => Promise<void> = async () => {};
	bigPrompt({ registerCommand: (_n: string, o: any) => (handler = o.handler) } as any);

	const calls = { box: undefined as string | undefined, notes: [] as [string, string][], stopped: 0, started: 0 };
	const ctx = {
		mode: "tui",
		ui: {
			getEditorText: () => initialBox,
			setEditorText: (t: string) => (calls.box = t),
			notify: (m: string, l: string) => calls.notes.push([m, l]),
			custom: async (f: any) => {
				let result: any;
				f({ stop: () => calls.stopped++, start: () => calls.started++, requestRender() {} }, {}, {}, (r: any) => (result = r));
				return result;
			},
		},
	};
	return { run: (args = "") => handler(args, ctx), calls, ctx };
}

test("command: editor edits file, text lands in input box, TUI stopped/restarted", async () => {
	const t = setup(`printf 'edited\\n\\n' >> "$1"`, "seed");
	await t.run();
	assert.equal(t.calls.box, "seededited");
	assert.deepEqual([t.calls.stopped, t.calls.started], [1, 1]);
});

test("command: args seed the file instead of input box", async () => {
	const t = setup(`printf ' +x' >> "$1"`, "box text");
	await t.run("from args");
	assert.equal(t.calls.box, "from args +x");
});

test("command: file is the one the editor receives (path with quotes handled by shell)", async () => {
	const t = setup(`echo "$1" | grep -q 'prompt.md$' && printf ok >> "$1"`, "");
	await t.run();
	assert.equal(t.calls.box, "ok");
});

test("command: no change leaves input box alone", async () => {
	const t = setup("true", "same");
	await t.run();
	assert.equal(t.calls.box, undefined);
	assert.equal(t.calls.notes[0]?.[0], "No changes");
});

test("command: non-zero exit warns and leaves input box alone", async () => {
	const t = setup(`printf junk >> "$1"; exit 3`, "keep");
	await t.run();
	assert.equal(t.calls.box, undefined);
	assert.deepEqual(t.calls.notes[0], ["Editor exited with code 3; prompt unchanged", "warning"]);
});

test("command: missing editor binary reports error", async () => {
	const t = setup("true");
	process.env.EDITOR = "/nonexistent/editor-xyz";
	await t.run("x");
	assert.equal(t.calls.box, undefined);
	assert.deepEqual(t.calls.notes[0], ["Editor exited with code 127; prompt unchanged", "warning"]);
});

test("command: refuses outside TUI", async () => {
	const t = setup("true");
	t.ctx.mode = "print";
	await t.run();
	assert.deepEqual(t.calls.notes[0], ["/edit needs the interactive TUI", "error"]);
});

test("command: temp dir removed after run (success and failure)", async () => {
	const count = () => readdirSync(tmpdir()).filter((n) => n.startsWith("pi-prompt-")).length;
	const before = count();
	await setup(`printf a >> "$1"`).run();
	await setup(`exit 1`).run();
	assert.equal(count(), before);
});
