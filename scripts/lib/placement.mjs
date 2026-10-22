/**
 * Fine-tunes a reference placement before tracing: the generators compare the
 * two pictures closely, so a placement a few percent off (by hand, or an old
 * Auto-align) spoils them. Searches size (x and y separately) and position
 * around the given placement for the best match of the two pictures' detail
 * (normalised cross-correlation of edge strength), coarse to fine.
 * Rotation / skew in the placement are kept as they are.
 *
 *   const { T, before, after } = await refinePlacement(sceneFile, refFile, T0);
 */
import sharp from "sharp";

/** Edge strength of the image at `width` px wide, lightly blurred. */
async function edges(file, width) {
  const { data, info } = await sharp(file).resize({ width }).removeAlpha().greyscale().blur(1).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    g[i] = Math.hypot(data[i + 1] - data[i - 1], data[i + w] - data[i - w]);
  }
  return { g, w, h };
}

/** Similarity (−1…1) of reference and scene under T (reference% → scene%). */
function score(S, R, T, step) {
  const [a, b, c, d, e, f] = T;
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = 2; y < R.h - 2; y += step) for (let x = 2; x < R.w - 2; x += step) {
    const px = ((x + 0.5) / R.w) * 100, py = ((y + 0.5) / R.h) * 100;
    const X = ((a * px + b * py + c) / 100) * S.w - 0.5, Y = ((d * px + e * py + f) / 100) * S.h - 0.5;
    const xi = Math.floor(X), yi = Math.floor(Y);
    if (xi < 0 || yi < 0 || xi >= S.w - 1 || yi >= S.h - 1) continue;
    const fx = X - xi, fy = Y - yi, i = yi * S.w + xi;
    const v = (S.g[i] * (1 - fx) + S.g[i + 1] * fx) * (1 - fy) + (S.g[i + S.w] * (1 - fx) + S.g[i + S.w + 1] * fx) * fy;
    const r = R.g[y * R.w + x];
    n++; sa += v; sb += r; saa += v * v; sbb += r * r; sab += v * r;
  }
  if (n < 200) return -1;
  const cov = sab - (sa * sb) / n, va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
}

/** Pattern search on x-size, y-size and position, keeping the reference's centre fixed while resizing. */
function search(S, R, T0, sizeStep, posStep, minSize, minPos, sample) {
  let T = T0.slice(), best = score(S, R, T, sample);
  const centre = (t) => [t[0] * 50 + t[1] * 50 + t[2], t[3] * 50 + t[4] * 50 + t[5]];
  const resize = (t, kx, ky) => {
    const [cx, cy] = centre(t);
    const n = [t[0] * kx, t[1] * ky, 0, t[3] * kx, t[4] * ky, 0];
    const [nx, ny] = centre(n);
    n[2] = cx - nx; n[5] = cy - ny;
    return n;
  };
  for (let s = sizeStep, p = posStep; s >= minSize || p >= minPos; ) {
    let improved = false;
    const tries = [
      resize(T, 1 + s, 1), resize(T, 1 - s, 1), resize(T, 1, 1 + s), resize(T, 1, 1 - s),
      resize(T, 1 + s, 1 + s), resize(T, 1 - s, 1 - s),
      [T[0], T[1], T[2] + p, T[3], T[4], T[5]], [T[0], T[1], T[2] - p, T[3], T[4], T[5]],
      [T[0], T[1], T[2], T[3], T[4], T[5] + p], [T[0], T[1], T[2], T[3], T[4], T[5] - p],
    ];
    for (const t of tries) {
      const v = score(S, R, t, sample);
      if (v > best + 1e-4) { best = v; T = t; improved = true; }
    }
    if (!improved) { s /= 2; p /= 2; }
  }
  return { T, best };
}

/** The same placement without rotation / skew, keeping its centre and size. */
function straighten(T) {
  const [a, b, c, d, e, f] = T;
  const cx = a * 50 + b * 50 + c, cy = d * 50 + e * 50 + f;
  const sx = Math.hypot(a, d), sy = Math.hypot(b, e);
  return [sx, 0, cx - sx * 50, 0, sy, cy - sy * 50];
}

export async function refinePlacement(sceneFile, refFile, T0) {
  const S1 = await edges(sceneFile, 400), R1 = await edges(refFile, 300);
  const S2 = await edges(sceneFile, 1000), R2 = await edges(refFile, 800);
  const before = score(S1, R1, T0, 1);
  const start = score(S2, R2, T0, 2);
  // Start from the given placement and from it without rotation / skew (hand-
  // clicked matching points often add a little of both), with small and large
  // first steps; keep the best match.
  const starts = [T0];
  if (Math.abs(T0[1]) > 1e-6 || Math.abs(T0[3]) > 1e-6) starts.push(straighten(T0));
  let best = { T: T0, after: start };
  for (const T of starts) for (const [size, pos] of [[0.04, 2], [0.12, 6]]) {
    const coarse = search(S1, R1, T, size, pos, 0.004, 0.1, 1);
    const fine = search(S2, R2, coarse.T, 0.008, 0.4, 0.0005, 0.02, 2);
    const after = score(S2, R2, fine.T, 2);
    if (after > best.after) best = { T: fine.T, after };
  }
  // keep the given placement unless the new one is clearly better
  return best.after > start + 0.01 ? { T: best.T, before, after: best.after, changed: true } : { T: T0, before, after: start, changed: false };
}
