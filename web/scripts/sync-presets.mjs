import {
  mkdir,
  readdir,
  copyFile,
  writeFile,
  readFile,
} from "node:fs/promises";
import { resolve, join, relative, basename } from "node:path";

const sourceDir = resolve("assets/data");
const distRoot = resolve("web/dist");
const dataDir = join(distRoot, "assets/data");
const manifestPath = join(distRoot, "assets/presets.json");

function toLabel(id) {
  return id
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function syncPresets() {
  await mkdir(dataDir, { recursive: true });

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const manifest = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith(".json") || entry.name.endsWith(".json.meta")) {
      continue;
    }

    const sourceFile = join(sourceDir, entry.name);
    const targetFile = join(dataDir, entry.name);
    await copyFile(sourceFile, targetFile);

    const id = basename(entry.name, ".json");
    manifest.push({
      id,
      label: toLabel(id),
      path: `dist/assets/data/${entry.name}`,
    });
  }

  manifest.sort((a, b) => a.label.localeCompare(b.label));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await rewriteImports();
  console.log(
    `[sync-presets] Copied ${manifest.length} preset(s) -> web/dist, generated manifest, and patched module imports.`
  );
}

async function rewriteImports() {
  const jsFiles = await collectJsFiles(distRoot);
  const patched = [];

  for (const filePath of jsFiles) {
    const content = await readFile(filePath, "utf8").catch((err) => {
      if (err && err.code !== "ENOENT") {
        throw err;
      }
      return null;
    });
    if (content === null) {
      continue;
    }

    const updated = content.replace(
      /(from\s+"(\.\.?\/[^"\n]+))"/g,
      (match, prefix, path) => {
        if (path.endsWith(".js") || path.endsWith(".mjs")) {
          return match;
        }
        return `${prefix}.js"`;
      }
    );

    if (updated !== content) {
      await writeFile(filePath, updated, "utf8");
      patched.push(filePath);
    }
  }

  patched.forEach((filePath) =>
    console.log(`  • patched imports in ${relative(distRoot, filePath)}`)
  );
}

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

syncPresets().catch((err) => {
  console.error("[sync-presets] Failed", err);
  process.exitCode = 1;
});
