import fsp from "node:fs/promises";
import path from "node:path";

const MACH_O_MAGICS = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
  0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca
]);

const [rootInput] = process.argv.slice(2);
if (!rootInput || !path.isAbsolute(rootInput)) {
  throw new Error("usage: macho-inventory.mjs <absolute-directory>");
}
const root = path.resolve(rootInput);
const rootStat = await fsp.lstat(root).catch(() => null);
if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
  throw new Error("Mach-O inventory root must be a real directory");
}

const files = [];
async function walk(directory) {
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)
        || relative.includes("\n") || relative.includes("\r")) {
      throw new Error(`unsafe release inventory path: ${relative}`);
    }
    if (entry.isSymbolicLink()) {
      const target = await fsp.readlink(absolute);
      const resolved = path.resolve(directory, target);
      const containment = path.relative(root, resolved);
      if (path.isAbsolute(target) || containment === ".." || containment.startsWith(`..${path.sep}`)
          || !await fsp.realpath(absolute).catch(() => null)) {
        throw new Error(`unsafe release symlink: ${relative}`);
      }
    } else if (entry.isDirectory()) {
      await walk(absolute);
    } else if (entry.isFile()) {
      const handle = await fsp.open(absolute, "r");
      try {
        const header = Buffer.alloc(4);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        if (bytesRead === 4 && MACH_O_MAGICS.has(header.readUInt32BE(0))) files.push(absolute);
      } finally {
        await handle.close();
      }
    } else {
      throw new Error(`unsupported release inventory entry: ${relative}`);
    }
  }
}

await walk(root);
files.sort((left, right) => left.localeCompare(right));
process.stdout.write(files.length ? `${files.join("\n")}\n` : "");
