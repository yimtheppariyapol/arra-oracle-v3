/**
 * Free TCP port for a test-owned server.
 *
 * HTTP/CLI contract tests used to reuse whatever answered on localhost:47778. On a machine running
 * the live oracle that is production, and knowledge/compare seed it with POST /api/learn
 * (2026-09-11). Every test server now gets its own port; HOME/ORACLE_* come from the hermetic
 * preload (src/test-setup/hermetic.ts).
 */
import net from "node:net";

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
