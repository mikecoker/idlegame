import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

const dataRoot = path.resolve(__dirname, "../assets/data");

async function copyDir(source: string, destination: string) {
  await fs.promises.mkdir(destination, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(source, entry.name);
      const destPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.promises.copyFile(srcPath, destPath);
      }
    })
  );
}

function serveGameData() {
  let resolvedOutDir = "";
  return {
    name: "idle-eq-serve-game-data",
    configResolved(config: any) {
      resolvedOutDir = config.build.outDir;
    },
    configureServer(server: any) {
      server.middlewares.use("/assets/data", async (req: any, res: any, next: any) => {
        try {
          const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
          const relativePath = urlPath.replace(/^\//, "");
          const filePath = path.join(dataRoot, relativePath);
          const stats = await fs.promises.stat(filePath);
          if (!stats.isFile()) {
            next();
            return;
          }

          const ext = path.extname(filePath);
          if (ext === ".json") {
            res.setHeader("Content-Type", "application/json");
          }
          const stream = fs.createReadStream(filePath);
          stream.on("error", next);
          stream.pipe(res);
        } catch (err) {
          next();
        }
      });
    },
    async writeBundle() {
      if (!resolvedOutDir) {
        return;
      }
      const targetDir = path.resolve(resolvedOutDir, "assets/data");
      await fs.promises.rm(targetDir, { recursive: true, force: true });
      await copyDir(dataRoot, targetDir);
    },
  };
}

export default defineConfig({
  plugins: [react(), serveGameData()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      { find: "@core", replacement: path.resolve(__dirname, "../core") },
      { find: "@assets", replacement: path.resolve(__dirname, "../assets") },
      { find: "@web", replacement: path.resolve(__dirname) },
    ],
  },
  server: {
    port: 4321,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
  preview: {
    port: 4321,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
});
