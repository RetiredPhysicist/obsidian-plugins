// Obsidian loads a plugin only when its release tag, package.json,
// manifest.json, and the versions.json entry name the same version.
// Usage: node script/version-packages.mjs <plugin> <version>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [plugin, version] = process.argv.slice(2);

if (!plugin || !version) {
  console.error("usage: node script/version-packages.mjs <plugin> <version>");
  process.exit(1);
}
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
  console.error("version must be X.Y.Z, got: " + version);
  process.exit(1);
}

const dir = join(root, "packages", plugin);
const read = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));
const write = (name, value) =>
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");

const pkg = read("package.json");
const manifest = read("manifest.json");
const versionsPath = join(dir, "versions.json");
const versions = existsSync(versionsPath) ? read("versions.json") : {};

pkg.version = version;
manifest.version = version;
versions[version] = manifest.minAppVersion;

write("package.json", pkg);
write("manifest.json", manifest);
write("versions.json", versions);

execFileSync(
  "npm",
  ["install", "--package-lock-only", "--workspaces=false", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: dir, stdio: "inherit" },
);

console.log(basename(dir) + " -> " + version + " (minAppVersion " + manifest.minAppVersion + ")");
