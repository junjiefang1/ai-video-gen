/**
 * 用 Canvas 把"对白字幕"渲染为透明背景 PNG（dataUrl）。
 * 支持中文（依赖浏览器系统中文字体回退，不需要内置字体文件）。
 *
 * 使用场景：HappyHorse 视频模型对中文渲染必乱码，所以中文一律走"后期烧录"——
 * 由本函数生成透明 PNG，再用 ffmpeg overlay 叠加到视频底部居中位置。
 *
 * 字幕样式固定：白字 + 黑色描边、加粗、底部居中、标准字幕字号
 * （不暴露 position/color/fontSize 等参数 —— 字幕样式应在全片保持一致）
 */

const FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", system-ui, sans-serif'

export interface RenderedSubtitle {
  pngDataUrl: string // 透明背景的字幕 PNG
  width: number
  height: number
}

/**
 * 渲染对白字幕为透明 PNG dataUrl
 * @param text 字幕文本
 * @param scale 视频缩放系数（720p 基准为 1，1080p 为 1.5）
 */
export function renderSubtitleToPng(text: string, scale = 1): RenderedSubtitle | null {
  const trimmed = (text || '').trim()
  if (!trimmed) return null

  const fontSize = Math.max(20, Math.round(40 * scale)) // 720p 基准 40px
  const fontWeight = 'bold'
  const padding = Math.round(fontSize * 0.5)
  const strokeWidth = Math.max(3, Math.round(fontSize * 0.12))

  // 1) 先用临时 canvas 测量文字尺寸
  const probe = document.createElement('canvas')
  const probeCtx = probe.getContext('2d')!
  probeCtx.font = `${fontWeight} ${fontSize}px ${FONT_FAMILY}`
  const metrics = probeCtx.measureText(trimmed)
  const textWidth = Math.ceil(metrics.width)
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.85
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.25
  const textHeight = Math.ceil(ascent + descent)

  const canvasWidth = textWidth + padding * 2
  const canvasHeight = textHeight + padding * 2

  // 2) 正式 canvas 绘制
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')!
  ctx.font = `${fontWeight} ${fontSize}px ${FONT_FAMILY}`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  const x = padding
  const y = padding + ascent

  // 3) 黑色描边（标准字幕样式 - 白字配黑边）
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = strokeWidth
  ctx.strokeText(trimmed, x, y)

  // 4) 白色填充
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText(trimmed, x, y)

  return {
    pngDataUrl: canvas.toDataURL('image/png'),
    width: canvasWidth,
    height: canvasHeight,
  }
}

/**
 * 字幕的 ffmpeg overlay 坐标：底部居中，距底部约 8% 留白。
 * W/H 是主视频尺寸，w/h 是字幕 PNG 尺寸。
 */
export function subtitleFFmpegXY(): { x: string; y: string } {
  return {
    x: '(W-w)/2',
    y: 'H-h-(H*0.08)',
  }
}

/** 根据分辨率字符串获取缩放系数（720p 为 1） */
export function resolutionToScale(resolution: '720p' | '1080p'): number {
  return resolution === '1080p' ? 1.5 : 1
}
