import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collect(path);
    return /\.(ts|css)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const files = await collect("src");
const errors = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  if (/\bany\b/.test(source)) errors.push(`${file}: explicit any is not allowed`);
  if (/prototype[\\/]/.test(source)) errors.push(`${file}: prototype imports are not allowed`);
  if (/\bTODO\b/.test(source)) errors.push(`${file}: TODO markers are not allowed`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`lint ok (${files.length} files)`);
}
