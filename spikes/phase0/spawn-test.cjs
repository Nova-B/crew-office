// Phase 0: Windows에서 Node spawn 으로 CLI 래퍼를 부를 수 있는지 (deskrpg subprocess-pool 은 shell:false)
const { spawn } = require("node:child_process");
const cases = [
  ["claude", { shell: false }],
  ["codex", { shell: false }],
  ["claude.cmd", { shell: false }],
  ["claude", { shell: true }],
  ["codex", { shell: true }],
];
(async () => {
  for (const [cmd, opts] of cases) {
    await new Promise((resolve) => {
      let out = "";
      let child;
      try { child = spawn(cmd, ["--version"], opts); }
      catch (e) { console.log(`${cmd} ${JSON.stringify(opts)} -> THROW ${e.code || e.message}`); return resolve(); }
      child.stdout.on("data", (d) => (out += d));
      child.on("error", (e) => { console.log(`${cmd} ${JSON.stringify(opts)} -> ERROR ${e.code}`); resolve(); });
      child.on("close", (code) => { if (code !== null) console.log(`${cmd} ${JSON.stringify(opts)} -> exit ${code} ${out.trim()}`); resolve(); });
    });
  }
})();
