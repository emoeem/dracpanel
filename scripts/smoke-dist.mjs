// Serves dist/ over a throwaway HTTP server and verifies the built index.html
// actually references assets that exist. Catches broken `base` configs, missing
// favicon.svg, and assets dropped by the bundler without needing a browser.
import { createServer, request as httpRequest } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST_ROOT = `${resolvePath(fileURLToPath(new URL("../dist", import.meta.url)))}${sep}`;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Any <script src> / <link href> pointing at a relative asset other than "/".
const ASSET_PATTERN = /(?:src|href)="(\.[^"]+)"/g;
const FETCHABLE_EXTENSIONS = [".js", ".css", ".svg"];

async function serve(request, response) {
  const { pathname } = new URL(request.url, "http://127.0.0.1");
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const target = resolvePath(DIST_ROOT, relative === "" ? "index.html" : relative);

  // Never serve anything outside dist/.
  if (!target.startsWith(DIST_ROOT)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  const info = await stat(target).catch(() => null);

  if (info === null || !info.isFile()) {
    response.writeHead(404).end("Not Found");
    return;
  }

  const body = await readFile(target);
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(target)] ?? "application/octet-stream",
    "Content-Length": body.length,
  });

  // HEAD must not write a body or the client will hang waiting for it.
  response.end(request.method === "HEAD" ? undefined : body);
}

function listen(server) {
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => done(server.address().port));
  });
}

// Resolves to { status, body }; body is null unless the response was 200.
function fetchAsset(port, method, path) {
  return new Promise((done, fail) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, method, path, agent: false },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () =>
          done({
            status: response.statusCode,
            body: response.statusCode === 200 ? chunks.join("") : null,
          }),
        );
      },
    );

    request.once("error", fail);
    request.end();
  });
}

function referencedAssets(html) {
  const assets = new Set();

  for (const [, value] of html.matchAll(ASSET_PATTERN)) {
    if (FETCHABLE_EXTENSIONS.includes(extname(value.split("?")[0]))) {
      // "./assets/x.js" -> "/assets/x.js" so it is a valid request-target.
      assets.add(new URL(value, "http://127.0.0.1/").pathname);
    }
  }

  return [...assets];
}

async function main() {
  const server = createServer(serve);
  const port = await listen(server);
  const failures = [];

  try {
    const { status, body } = await fetchAsset(port, "GET", "/");

    if (status !== 200) {
      failures.push(`GET / returned ${status}, expected dist/index.html to be served`);
      return failures;
    }

    console.log(`[smoke] GET / -> 200 (${body.length} bytes)`);

    if (body.includes("favicon.svg")) {
      console.log("[smoke] ok   favicon.svg referenced in index.html");
    } else {
      failures.push("index.html does not reference favicon.svg");
    }

    const assets = referencedAssets(body);
    console.log(`[smoke] ${assets.length} js/css assets referenced by index.html`);

    for (const asset of assets) {
      const head = await fetchAsset(port, "HEAD", asset);
      // Some static hosts answer HEAD poorly; a 200 GET still proves the file ships.
      const { status: assetStatus } = head.status === 200 ? head : await fetchAsset(port, "GET", asset);

      if (assetStatus === 200) {
        console.log(`[smoke] ok   ${asset} -> 200`);
      } else {
        failures.push(`${asset} -> ${assetStatus}`);
      }
    }
  } finally {
    server.closeAllConnections?.();
    server.close();
  }

  return failures;
}

let failures;

try {
  failures = await main();
} catch (error) {
  console.error(`[smoke] FAIL ${error.message}`);
  failures = [error.message];
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[smoke] FAIL ${failure}`);
  }

  console.error(`[smoke] ${failures.length} check(s) failed`);
} else {
  console.log("[smoke] PASS all checks succeeded");
}

process.exitCode = failures.length > 0 ? 1 : 0;
