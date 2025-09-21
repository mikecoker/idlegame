import { mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";

const sourceDir = resolve("assets/data");
const targetDir = resolve("web/dist/assets/data");

async function copyPresets() {
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
  console.log(`[copy-presets] Copied ${sourceDir} -> ${targetDir}`);
}

copyPresets().catch((err) => {
  console.error("[copy-presets] Failed", err);
  process.exitCode = 1;
});
