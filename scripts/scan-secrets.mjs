import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SECRET_SCAN_IGNORED = new Set([
  ".build", ".git", "node_modules", "dist", "coverage", "models", "runtime", "work", "tmp"
]);
const PATTERNS = [
  { name: "GitHub token", pattern: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/g },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "Stripe secret", pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g }
];

export async function* walkSecretScanFiles(directory, ignored = SECRET_SCAN_IGNORED) {
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkSecretScanFiles(candidate, ignored);
    else if (entry.isFile()) yield candidate;
  }
}

async function main() {
  const findings = [];
  for await (const file of walkSecretScanFiles(ROOT)) {
    const stat = await fsp.stat(file);
    if (stat.size > 2 * 1024 * 1024) continue;
    const source = await fsp.readFile(file, "utf8").catch(() => null);
    if (source === null) continue;
    for (const { name, pattern } of PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) findings.push(`${path.relative(ROOT, file)}: ${name}`);
    }
  }

  if (findings.length) {
    process.stderr.write(`Potential secrets found:\n${findings.map((item) => `- ${item}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Secret scan passed.\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
