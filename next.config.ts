import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/** A package and everything it depends on, as globs under node_modules/ (missing optional ones skipped). */
function packageFiles(name: string, seen = new Set<string>()): string[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const dir = path.join("node_modules", name);
  let pkg: { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return [];
  }
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
  return [`./${dir}/**/*`, ...deps.flatMap((d) => packageFiles(d, seen))];
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The generators run as separate Node processes, so the build can't see
  // what they import: ship them, their packages and the OCR data with the route.
  outputFileTracingIncludes: {
    "/api/generate": ["./scripts/**/*.mjs", "./eng.traineddata", ...packageFiles("sharp"), ...packageFiles("tesseract.js")],
  },
};

export default nextConfig;
