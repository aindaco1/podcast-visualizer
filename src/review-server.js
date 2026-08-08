import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./canonical-json.js";
import { CliError } from "./errors.js";
import { descendantPath } from "./files.js";
import { validateReviewDraft } from "./review.js";
import {
  approveEditedReview, loadWorkingReview, saveWorkingReview
} from "./review-workspace.js";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(MODULE_ROOT, "../review-ui");
const MAXIMUM_JSON_BYTES = 2 * 1024 * 1024;
const MAXIMUM_AUDIO_RANGE_BYTES = 1024 * 1024;
const COOKIE = "pv_review";
const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});

function boundedEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function send(response, status, body = "", contentType = "text/plain; charset=utf-8", headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Content-Length": bytes.length,
    ...headers
  });
  response.end(bytes);
}

function sendJson(response, status, value, headers = {}) {
  send(response, status, canonicalJson(value), "application/json; charset=utf-8", headers);
}

async function readJson(request) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAXIMUM_JSON_BYTES) {
    throw new CliError("review request is too large");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAXIMUM_JSON_BYTES) {
      request.destroy();
      throw new CliError("review request is too large");
    }
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CliError("review request is not valid JSON");
  }
  return value;
}

function reviewCuePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== 1 || !Object.hasOwn(value, "cues")) {
    throw new CliError("review request fields are invalid");
  }
  return value.cues;
}

function cookieValue(request) {
  const header = String(request.headers.cookie ?? "");
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return "";
}

function safeAssetPath(urlPath) {
  const asset = urlPath === "/" ? "index.html" : urlPath.slice(1);
  if (!/^(?:index\.html|app\.js|styles\.css)$/.test(asset)) return null;
  return path.join(UI_ROOT, asset);
}

async function serveAsset(response, urlPath) {
  const assetPath = safeAssetPath(urlPath);
  if (!assetPath) return false;
  const body = await fsp.readFile(assetPath);
  const extension = path.extname(assetPath);
  const type = extension === ".html" ? "text/html; charset=utf-8"
    : extension === ".js" ? "text/javascript; charset=utf-8"
      : "text/css; charset=utf-8";
  send(response, 200, body, type);
  return true;
}

async function serveAudio(request, response, audioPath, contentType) {
  const stat = await fsp.stat(audioPath);
  const range = String(request.headers.range ?? "");
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const headers = { "Accept-Ranges": "bytes" };
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      send(response, 416, "invalid range", "text/plain; charset=utf-8", { "Content-Range": `bytes */${stat.size}` });
      return;
    }
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix < 1) {
        send(response, 416, "invalid range", "text/plain; charset=utf-8", { "Content-Range": `bytes */${stat.size}` });
        return;
      }
      start = Math.max(0, stat.size - Math.min(suffix, MAXIMUM_AUDIO_RANGE_BYTES));
      end = stat.size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : stat.size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
      send(response, 416, "invalid range", "text/plain; charset=utf-8", { "Content-Range": `bytes */${stat.size}` });
      return;
    }
    end = Math.min(end, stat.size - 1, start + MAXIMUM_AUDIO_RANGE_BYTES - 1);
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  }
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    "Content-Length": end - start + 1,
    ...headers
  });
  if (request.method === "HEAD") return response.end();
  await pipeline(fs.createReadStream(audioPath, { start, end }), response);
}

export async function createReviewServer({
  projectRoot,
  draft,
  audioPath,
  audioContentType = "audio/mp4",
  idleTimeoutMs = 30 * 60 * 1000,
  approvedAt = () => new Date().toISOString()
}) {
  validateReviewDraft(draft);
  const reviewDirectory = descendantPath(projectRoot, "review");
  await fsp.mkdir(reviewDirectory, { recursive: true, mode: 0o700 });
  const launchToken = randomBytes(32).toString("base64url");
  const sessionToken = randomBytes(32).toString("base64url");
  const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
  const audioToken = randomBytes(32).toString("base64url");
  const audioTokenHash = createHash("sha256").update(audioToken).digest("hex");
  let expectedOrigin;
  let approved = null;
  let idleTimer;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });

  const server = http.createServer(async (request, response) => {
    try {
      const host = String(request.headers.host ?? "");
      if (host !== expectedOrigin.slice("http://".length)) {
        send(response, 400, "invalid host");
        return;
      }
      const url = new URL(request.url, expectedOrigin);
      const origin = String(request.headers.origin ?? "");
      const sessionValid = boundedEqual(
        createHash("sha256").update(cookieValue(request)).digest("hex"),
        sessionHash
      );
      const audioTokenValid = url.pathname === "/api/audio" && boundedEqual(
        createHash("sha256").update(url.searchParams.get("token") ?? "").digest("hex"),
        audioTokenHash
      );

      if (request.method === "POST" && url.pathname === "/api/session") {
        if (origin !== expectedOrigin || !boundedEqual(request.headers["x-review-token"], launchToken)) {
          send(response, 403, "forbidden");
          return;
        }
        sendJson(response, 200, { ok: true, audioToken }, {
          "Set-Cookie": `${COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=1800`
        });
        return;
      }

      if (url.pathname.startsWith("/api/") && !sessionValid && !audioTokenValid) {
        send(response, 401, "review session required");
        return;
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && origin !== expectedOrigin) {
        send(response, 403, "invalid origin");
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/draft") {
        sendJson(response, 200, draft);
      } else if (request.method === "GET" && url.pathname === "/api/working") {
        const working = await loadWorkingReview(projectRoot, draft);
        sendJson(response, 200, { cues: working?.cues ?? draft.cues, hasWorkingCopy: working !== null });
      } else if (["GET", "HEAD"].includes(request.method) && url.pathname === "/api/audio") {
        await serveAudio(request, response, audioPath, audioContentType);
      } else if (request.method === "PUT" && url.pathname === "/api/working") {
        const payload = await readJson(request);
        const saved = await saveWorkingReview({
          projectRoot, draft, editedCues: reviewCuePayload(payload), savedAt: approvedAt()
        });
        sendJson(response, 200, saved);
      } else if (request.method === "POST" && url.pathname === "/api/approve") {
        const payload = await readJson(request);
        approved = await approveEditedReview({
          projectRoot, draft, editedCues: reviewCuePayload(payload), approvedAt: approvedAt()
        });
        sendJson(response, 201, {
          ok: true,
          transcriptId: approved.transcriptId,
          contentSha256: approved.contentSha256,
          manifestSha256: approved.manifestSha256
        });
        setImmediate(() => server.close());
      } else if (request.method === "GET" && await serveAsset(response, url.pathname)) {
        // Served above.
      } else {
        send(response, 404, "not found");
      }
    } catch (error) {
      const message = error instanceof CliError ? error.message : "review server failure";
      if (!response.headersSent) sendJson(response, 400, { error: message });
      else response.destroy();
    }
  });

  server.on("close", () => {
    clearTimeout(idleTimer);
    resolveClosed({ approved });
  });
  server.on("error", (error) => {
    clearTimeout(idleTimer);
    resolveClosed({ approved: null, error });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  expectedOrigin = `http://127.0.0.1:${address.port}`;
  idleTimer = setTimeout(() => server.close(), idleTimeoutMs);
  idleTimer.unref();

  return {
    origin: expectedOrigin,
    url: `${expectedOrigin}/#token=${launchToken}`,
    closed,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
