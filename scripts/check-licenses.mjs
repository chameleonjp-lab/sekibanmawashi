import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const missing = [];
const licenses = new Map();
for (const [location, metadata] of Object.entries(lock.packages ?? {})) {
  if (!location.startsWith("node_modules/") || typeof metadata !== "object" || metadata === null) continue;
  const license = metadata.license;
  if (typeof license !== "string" || license.length === 0) {
    missing.push(location);
    continue;
  }
  licenses.set(license, (licenses.get(license) ?? 0) + 1);
}

if (missing.length > 0) {
  console.error(`license metadata missing for ${missing.length} package(s):`);
  console.error(missing.join("\n"));
  process.exitCode = 1;
} else {
  const summary = [...licenses.entries()].sort(([left], [right]) => left.localeCompare(right));
  console.log(`license metadata ok (${summary.map(([name, count]) => `${name}:${count}`).join(", ")})`);
}
