import fsp from "node:fs/promises";
import path from "node:path";

export async function pythonPackageInventory(sitePackages) {
  const packages = [];
  for (const name of await fsp.readdir(sitePackages)) {
    if (!name.endsWith(".dist-info")) continue;
    const metadataPath = path.join(sitePackages, name, "METADATA");
    const metadata = await fsp.readFile(metadataPath, "utf8").catch(() => "");
    const packageName = /^Name:\s*(.+)$/mi.exec(metadata)?.[1]?.trim();
    const version = /^Version:\s*(.+)$/mi.exec(metadata)?.[1]?.trim();
    if (!packageName || !version) throw new Error(`package metadata is incomplete: ${name}`);
    packages.push({ name: packageName, version });
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}
