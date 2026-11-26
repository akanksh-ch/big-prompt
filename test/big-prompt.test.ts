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

function setup(editorScript: string, initialBox = "", idle = true) {
	const dir = mkdtempSync(join(tmpdir(), "bp-test-"));
	const ed = join(dir, "ed.sh");
	writeFileSync(ed, `#!/bin/sh\n${editorScript}\n`);
	chmodSync(ed, 0o755);
	process.env.EDITOR = ed;
	delete process.env.VISUAL;

	let handler: (args: string, ctx: any) => Promise<void> = async () => {};
	const calls = {
		sent: [] as [string, any][],
		box: undefined as string | undefined,
		notes: [] as [string, string][],
		stopped: 0,
		started: 0,
	};
	bigPrompt({
		registerCommand: (_n: string, o: any) => (handler = o.handler),
		sendUserMessage: (t: string, o: any) => calls.sent.push([t, o]),
	} as any);
	const ctx = {
		mode: "tui",
		isIdle: () => idle,
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

test("command: saved text is sent, input box cleared, TUI stopped/restarted", async () => {
	const t = setup(`printf ' edited\\n\\n' >> "$1"`, "seed");
	await t.run();
	assert.deepEqual(t.calls.sent, [["seed edited", undefined]]);
	assert.equal(t.calls.box, "");
	assert.deepEqual([t.calls.stopped, t.calls.started], [1, 1]);
});

test("command: args seed the file, input box left alone", async () => {
	const t = setup(`printf ' +x' >> "$1"`, "box text");
	await t.run("from args");
	assert.deepEqual(t.calls.sent, [["from args +x", undefined]]);
	assert.equal(t.calls.box, undefined);
});

test("command: editor gets the prompt.md path", async () => {
	const t = setup(`echo "$1" | grep -q 'prompt.md$' && printf ok >> "$1"`, "");
	await t.run();
	assert.equal(t.calls.sent[0]?.[0], "ok");
});

test("command: unchanged non-empty text still sends (like git)", async () => {
	const t = setup("true", "same");
	await t.run();
	assert.equal(t.calls.sent[0]?.[0], "same");
});

test("command: empty or whitespace-only text aborts", async () => {
	const t = setup(`printf '  \\n\\n' > "$1"`, "something");
	await t.run();
	assert.deepEqual(t.calls.sent, []);
	assert.equal(t.calls.box, undefined);
	assert.deepEqual(t.calls.notes[0], ["Aborting: empty prompt", "warning"]);
});

test("command: non-zero exit aborts, nothing sent, box kept", async () => {
	const t = setup(`printf junk >> "$1"; exit 3`, "keep");
	await t.run();
	assert.deepEqual(t.calls.sent, []);
	assert.equal(t.calls.box, undefined);
	assert.deepEqual(t.calls.notes[0], ["Editor exited with code 3; aborting, nothing sent", "warning"]);
});

test("command: missing editor binary aborts (shell exit 127)", async () => {
	const t = setup("true");
	process.env.EDITOR = "/nonexistent/editor-xyz";
	await t.run("x");
	assert.deepEqual(t.calls.sent, []);
	assert.deepEqual(t.calls.notes[0], ["Editor exited with code 127; aborting, nothing sent", "warning"]);
});

test("command: queued as followUp while agent is busy", async () => {
	const t = setup(`printf hi > "$1"`, "", false);
	await t.run();
	assert.deepEqual(t.calls.sent, [["hi", { deliverAs: "followUp" }]]);
});

test("command: markdown # headings are kept (no git-style comment stripping)", async () => {
	const t = setup(`printf '# Title\\nbody' > "$1"`);
	await t.run();
	assert.equal(t.calls.sent[0]?.[0], "# Title\nbody");
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
