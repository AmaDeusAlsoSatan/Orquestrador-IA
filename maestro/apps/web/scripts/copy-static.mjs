import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(webDir, "dist");
const assetsDir = path.join(distDir, "assets");

mkdirSync(assetsDir, { recursive: true });
cpSync(path.join(webDir, "index.html"), path.join(distDir, "index.html"));
cpSync(path.join(webDir, "src", "styles.css"), path.join(assetsDir, "styles.css"));
