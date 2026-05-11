#!/usr/bin/env node
/* eslint-disable */
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const net = require("node:net");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone", "server.js");
const NEXT_STATIC_SRC = path.join(ROOT, ".next", "static");
const NEXT_STATIC_DEST = path.join(ROOT, ".next", "standalone", ".next", "static");
const PUBLIC_SRC = path.join(ROOT, "public");
const PUBLIC_DEST = path.join(ROOT, ".next", "standalone", "public");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

// Subcommand dispatch: if the first positional arg matches a known query
// command, run that and exit instead of starting the web server.
const QUERY_COMMANDS = new Set([
  "projects",
  "sessions",
  "ls",
  "show",
  "cat",
  "tail",
  "search",
  "grep",
  "stats",
  "help",
]);
const first = args[0];
if (first && QUERY_COMMANDS.has(first)) {
  const { dispatch } = require("./cli-commands");
  dispatch(first, args.slice(1)).then(
    (code) => process.exit(code || 0),
    (e) => {
      console.error(e?.message || e);
      process.exit(1);
    },
  );
  return;
}

if (flag("--help") || flag("-h")) {
  require("./cli-commands").cmdHelp();
  process.exit(0);
}

const preferredPort = Number(arg("--port", 3838));

(async () => {
  if (flag("--dev")) {
    return runDev(preferredPort);
  }

  if (flag("--build") || !fs.existsSync(STANDALONE)) {
    await build();
  }

  // Make sure static + public are in standalone tree
  ensureStandaloneAssets();

  const port = await pickPort(preferredPort);
  const url = `http://localhost:${port}`;

  console.log(`\n  ▲ Claude Code Session Viewer`);
  console.log(`  ▸ http://localhost:${port}\n`);

  const child = spawn(process.execPath, [STANDALONE], {
    cwd: path.join(ROOT, ".next", "standalone"),
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: "inherit",
  });

  if (!flag("--no-open")) {
    waitForServer(port).then(async () => {
      try {
        const open = (await import("open")).default;
        await open(url);
      } catch {
        // ignore — user can still browse manually
      }
    });
  }

  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
})();

function ensureStandaloneAssets() {
  if (fs.existsSync(NEXT_STATIC_SRC)) {
    // Re-sync on every start: a rebuild produces fresh chunks under .next/static
    // and the standalone copy must match or the client loads stale code.
    if (fs.existsSync(NEXT_STATIC_DEST)) {
      fs.rmSync(NEXT_STATIC_DEST, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(NEXT_STATIC_DEST), { recursive: true });
    fs.cpSync(NEXT_STATIC_SRC, NEXT_STATIC_DEST, { recursive: true });
  }
  if (fs.existsSync(PUBLIC_SRC)) {
    if (fs.existsSync(PUBLIC_DEST)) {
      fs.rmSync(PUBLIC_DEST, { recursive: true, force: true });
    }
    fs.cpSync(PUBLIC_SRC, PUBLIC_DEST, { recursive: true });
  }
}

function build() {
  return new Promise((resolve, reject) => {
    console.log("Building (one-time)…");
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(npx, ["next", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build failed (exit ${code})`));
    });
  });
}

function runDev(port) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(npx, ["next", "dev", "-p", String(port)], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (!flag("--no-open")) {
    waitForServer(port).then(async () => {
      try {
        const open = (await import("open")).default;
        await open(`http://localhost:${port}`);
      } catch {}
    });
  }
  child.on("exit", (code) => process.exit(code ?? 0));
}

function pickPort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", () => tryPort(p + 1));
      srv.listen(p, "127.0.0.1", () => {
        srv.close(() => resolve(p));
      });
    };
    tryPort(start);
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.createConnection({ port, host: "127.0.0.1" }, () => {
        sock.end();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
        setTimeout(tick, 200);
      });
    };
    tick();
  });
}
