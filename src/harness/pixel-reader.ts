/**
 * Image statistics shared by every verb (`renderEffectFrame`,
 * `runDslProgram`) and the library export. Each field has one definition.
 * About 1000 pixels are sampled with a fixed stride over the RGBA buffer in
 * screen order; all values are over those samples, with channels in 0..1.
 */
export interface ImageMetrics {
  /** Mean R, G, B. */
  mean_rgb: [number, number, number]
  /** Mean alpha. */
  mean_alpha: number
  /** Standard deviation of R, G, B. */
  std_rgb: [number, number, number]
  /** Variance of Rec. 601 luma (0.299 R + 0.587 G + 0.114 B). */
  luma_variance: number
  /** Distinct exact 8-bit RGB triples among the samples. */
  unique_sampled_colors: number
  /** Every sample has R, G and B at or below 0.001. */
  is_all_zero: boolean
  /** Every sample has alpha at or below 0.001. */
  is_all_transparent: boolean
  /** The frame is flat: luma variance below 1e-4, at any brightness. */
  is_essentially_blank: boolean
  /** At most one distinct exact RGB triple. */
  is_monochrome: boolean
}

/**
 * Compute statistical metrics from RGBA pixel data.
 * Handles both Uint8Array (0-255) and Float32Array (0-1) input.
 *
 * This is the only implementation of `ImageMetrics`. The browser verbs read
 * the frame back to Node and call it, so a field means the same thing for
 * every verb and for library callers (issue #29).
 */
export function computeImageMetrics(data: Uint8Array | Float32Array, width: number, height: number): ImageMetrics {
  const pixelCount = width * height
  const isFloat = data instanceof Float32Array
  const scale = isFloat ? 1.0 : 1.0 / 255.0

  // Sample stride: aim for ~1000 pixel samples
  const sampleStride = Math.max(1, Math.floor(pixelCount / 1000))
  let sampleCount = 0

  let sumR = 0, sumG = 0, sumB = 0, sumA = 0
  let sumR2 = 0, sumG2 = 0, sumB2 = 0
  let sumLuma = 0, sumLuma2 = 0
  let allZero = true
  let allTransparent = true

  // Distinct exact 8-bit RGB triples
  const colorSet = new Set<number>()

  for (let p = 0; p < pixelCount; p += sampleStride) {
    const i = p * 4
    const r = data[i] * scale
    const g = data[i + 1] * scale
    const b = data[i + 2] * scale
    const a = data[i + 3] * scale

    sumR += r; sumG += g; sumB += b; sumA += a
    sumR2 += r * r; sumG2 += g * g; sumB2 += b * b

    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    sumLuma += luma
    sumLuma2 += luma * luma

    if (r > 0.001 || g > 0.001 || b > 0.001) allZero = false
    if (a > 0.001) allTransparent = false

    const qr = Math.round(Math.max(0, Math.min(1, r)) * 255)
    const qg = Math.round(Math.max(0, Math.min(1, g)) * 255)
    const qb = Math.round(Math.max(0, Math.min(1, b)) * 255)
    colorSet.add((qr << 16) | (qg << 8) | qb)

    sampleCount++
  }

  const n = sampleCount || 1
  const meanR = sumR / n
  const meanG = sumG / n
  const meanB = sumB / n
  const meanA = sumA / n
  const meanLuma = sumLuma / n

  const stdR = Math.sqrt(Math.max(0, sumR2 / n - meanR * meanR))
  const stdG = Math.sqrt(Math.max(0, sumG2 / n - meanG * meanG))
  const stdB = Math.sqrt(Math.max(0, sumB2 / n - meanB * meanB))
  const lumaVariance = Math.max(0, sumLuma2 / n - meanLuma * meanLuma)

  const uniqueColors = colorSet.size
  const isBlank = lumaVariance < 1e-4

  return {
    mean_rgb: [meanR, meanG, meanB],
    mean_alpha: meanA,
    std_rgb: [stdR, stdG, stdB],
    luma_variance: lumaVariance,
    unique_sampled_colors: uniqueColors,
    is_all_zero: allZero,
    is_all_transparent: allTransparent,
    is_essentially_blank: isBlank,
    is_monochrome: uniqueColors <= 1,
  }
}
