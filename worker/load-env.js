/**
 * Load env for GenEx worker processes (worker.js, text-video-worker.js).
 *
 * Order:
 * 1. worker/.env (same folder as worker.js; does not override vars already set by the host)
 * 2. App root `.env` then `.env.local` with override (see findGenexAppRoot)
 * 3. Default dotenv.config() for cwd `.env` (override off)
 *
 * App root is the directory whose package.json has `"name": "genex"` (walks up from the
 * worker folder and from process.cwd()). This covers monorepos where `genex/worker` is not
 * exactly one level below the Next app. Optional: set GENEX_APP_ROOT=/abs/path/to/genex
 * (e.g. Docker bind-mount of secrets next to the worker).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

/** @param {string} dir */
function readPackageName(dir) {
  const p = path.join(dir, "package.json");
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return typeof j?.name === "string" ? j.name : null;
  } catch {
    return null;
  }
}

/**
 * Directory of the Next app (package name `genex`), or null if not found.
 * @param {string} startDir absolute or resolved path to start walking from
 */
function findGenexAppRoot(startDir) {
  const override = process.env.GENEX_APP_ROOT?.trim();
  if (override) return path.resolve(override);

  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (readPackageName(dir) === "genex") return dir;
    const par = path.dirname(dir);
    if (par === dir) break;
    dir = par;
  }
  return null;
}

/**
 * @param {string} entryImportMetaUrl import.meta.url of the entry file (worker.js or text-video-worker.js)
 */
export function loadGenexWorkerEnv(entryImportMetaUrl) {
  const workerDir = path.dirname(fileURLToPath(entryImportMetaUrl));

  dotenv.config({ path: path.join(workerDir, ".env") });

  /** @type {string[]} */
  const roots = [];
  const fromWorker = findGenexAppRoot(workerDir);
  if (fromWorker) roots.push(fromWorker);
  const fromCwd = findGenexAppRoot(process.cwd());
  if (fromCwd && fromCwd !== fromWorker) roots.push(fromCwd);

  for (const root of roots) {
    const envPath = path.join(root, ".env");
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: true });
    }
    const localPath = path.join(root, ".env.local");
    if (fs.existsSync(localPath)) {
      dotenv.config({ path: localPath, override: true });
    }
  }

  dotenv.config();
}
