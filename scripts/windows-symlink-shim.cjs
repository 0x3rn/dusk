// scripts/windows-symlink-shim.cjs
// Local Windows builds only. OpenNext creates symbolic links while bundling, and Windows refuses
// that without administrator rights or Developer Mode (EPERM). When that happens this falls back
// to a directory junction (needs no rights) or a plain copy, which give the same result.
// Linux and macOS builds, including every real deploy, never load this file.
/* eslint-disable @typescript-eslint/no-require-imports -- loaded with `node --require`, so it must be CommonJS */
const fs = require("node:fs");
const path = require("node:path");

const originalSymlinkSync = fs.symlinkSync;

fs.symlinkSync = function symlinkSyncWithFallback(target, linkPath, type) {
  try {
    return originalSymlinkSync.call(fs, target, linkPath, type);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    const absoluteTarget = path.resolve(path.dirname(String(linkPath)), String(target));
    let stat;
    try {
      stat = fs.statSync(absoluteTarget);
    } catch {
      throw error; // The link points at nothing we can copy, so report the original problem.
    }
    if (stat.isDirectory()) return originalSymlinkSync.call(fs, absoluteTarget, linkPath, "junction");
    return fs.copyFileSync(absoluteTarget, linkPath);
  }
};
