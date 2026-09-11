/**
 * Shared server fixture — spawn a test-owned src/server.ts on a free port.
 * Never reuses a server that is already up on 47778: on a machine running the live oracle that is
 * production, and menu add/remove write to it. ORACLE_API is pointed at the test server so the CLI
 * subprocesses (tests/cli/_run.ts inherits process.env) reach it instead of the default 47778.
 */
import type { Subprocess } from "bun";
import { getFreePort } from "../_free-port.ts";

export let BASE_URL = "";

let serverProcess: Subprocess | null = null;

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isServerRunning()) return true;
    await Bun.sleep(500);
  }
  return false;
}

const REPO_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

export async function ensureServer(): Promise<void> {
  if (serverProcess && BASE_URL && (await isServerRunning())) return;
  const port = await getFreePort();
  BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ORACLE_API = BASE_URL;
  serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ORACLE_PORT: String(port), ORACLE_CHROMA_TIMEOUT: "3000" },
  });
  const ready = await waitForServer();
  if (!ready) throw new Error("Server failed to start for tests/cli/");
}

export function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}
