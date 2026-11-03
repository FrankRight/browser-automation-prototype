// Starts the runner and the web app's dev server together, and stops both on Ctrl+C.
// The runner prints the address to open; it ends in #token=…, which signs the page in.
import { spawn } from "node:child_process";

const apps = [
  { name: "runner", command: "uv", args: ["run", "python", "server.py"], cwd: "apps/runner", env: { WEB_URL: "http://localhost:5173" } },
  { name: "web", command: "pnpm", args: ["--filter", "web", "dev"], cwd: "." },
];

const children = apps.map(({ name, command, args, cwd, env }) => {
  // Each app gets its own process group, so stopping it stops everything it started (pnpm's vite, uv's python).
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const relay = (stream, out) =>
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) if (line.trim()) out.write(`[${name}] ${line}\n`);
    });
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`[${name}] stopped${code ? ` (exit ${code})` : ""}`);
    stop();
  });
  return child;
});

function stop() {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // that group has already gone
    }
  }
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
