import { createHash } from "node:crypto";

export function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts plain objects only");
    }
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => {
        const child = value[key];
        if (child === undefined) throw new TypeError(`Canonical JSON rejects undefined at ${key}`);
        return [key, canonicalize(child)];
      })
    );
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value}`);
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

export function sha256(value) {
  const input = Buffer.isBuffer(value) || typeof value === "string"
    ? value
    : canonicalJson(value);
  return createHash("sha256").update(input).digest("hex");
}

