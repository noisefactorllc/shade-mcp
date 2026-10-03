import type { Backend } from '../config.js'

export interface ViewerGlobals {
  canvasRenderer: string
  renderingPipeline: string
  currentBackend: string
  currentEffect: string
  setPaused: string
  setPausedTime: string
  frameCount: string
}

export const DEFAULT_GLOBALS: ViewerGlobals = {
  canvasRenderer: '__shadeCanvasRenderer',
  renderingPipeline: '__shadeRenderingPipeline',
  currentBackend: '__shadeCurrentBackend',
  currentEffect: '__shadeCurrentEffect',
  setPaused: '__shadeSetPaused',
  setPausedTime: '__shadeSetPausedTime',
  frameCount: '__shadeFrameCount',
}

export function globalsFromPrefix(prefix: string): ViewerGlobals {
  return {
    canvasRenderer: `${prefix}CanvasRenderer`,
    renderingPipeline: `${prefix}RenderingPipeline`,
    currentBackend: `${prefix}CurrentBackend`,
    currentEffect: `${prefix}CurrentEffect`,
    setPaused: `${prefix}SetPaused`,
    setPausedTime: `${prefix}SetPausedTime`,
    frameCount: `${prefix}FrameCount`,
  }
}

export interface BrowserSessionOptions {
  backend: Backend
  blankPage?: boolean
  headless?: boolean
  viewerPort?: number
  viewerRoot?: string
  viewerPath?: string
  effectsDir?: string
  globals?: ViewerGlobals
  timeoutMs?: number
}

export interface ImageMetrics {
  mean_rgb: [number, number, number]
  mean_alpha: number
  std_rgb: [number, number, number]
  luma_variance: number
  unique_sampled_colors: number
  is_all_zero: boolean
  is_all_transparent: boolean
  is_essentially_blank: boolean
  is_monochrome: boolean
}

export interface CompileResult {
  status: 'ok' | 'error'
  backend: string
  passes: Array<{ id: string; status: 'ok' | 'error'; errors?: string[] }>
  message: string
  console_errors?: string[]
}

export interface RenderResult {
  status: 'ok' | 'error'
  backend: string
  error?: string
  // Echo of the `resolution` request, present whenever one was made,
  // including error results (the caller must see the request even when
  // rendering fails).
  requested_resolution?: [number, number]
  // Set when the captured frame size differs from `requested_resolution`:
  // a requested resolution is never silently accepted as `ok`.
  warning?: string
  frame?: { image_uri?: string; width: number; height: number }
  metrics?: ImageMetrics
  console_errors?: string[]
}

export interface BenchmarkResult {
  status: 'ok' | 'error'
  backend: string
  achieved_fps: number
  meets_target: boolean
  // Echo of the `resolution` request, present whenever one was made.
  requested_resolution?: [number, number]
  // Set when the measured frame size differs from `requested_resolution`.
  warning?: string
  // Frame size the benchmark measured at (the viewer's canvas backing size).
  frame?: { width: number; height: number }
  stats: {
    frame_count: number
    avg_frame_time_ms: number
    jitter_ms: number
    min_frame_time_ms: number
    max_frame_time_ms: number
  }
  console_errors?: string[]
}

export interface ParityResult {
  status: 'ok' | 'error' | 'mismatch'
  maxDiff: number
  meanDiff: number
  mismatchCount: number
  mismatchPercent: number
  resolution: [number, number]
  details: string
  console_errors?: string[]
  // Solid-color + Y-flip diagnostics (populated by testPixelParity)
  glslSolid?: boolean
  wgslSolid?: boolean
  glslVariance?: number[]
  wgslVariance?: number[]
  yFlipDetected?: boolean
  yFlipCleanFlip?: boolean
  yFlipMismatchPercent?: number
  yFlipMeanDiff?: number
  yFlipRatio?: number
  issues?: string[]
}
