/**
 * 用 ffmpeg.wasm 把"对白字幕"PNG 叠加到视频底部居中位置（overlay 滤镜）。
 * 每段视频生成完成后调用本模块，把本段的 dialogue 烧到画面下方。
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'
import { renderSubtitleToPng, subtitleFFmpegXY, resolutionToScale } from './text-overlay'

let ffmpegInstance: FFmpeg | null = null

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance

  const ffmpeg = new FFmpeg()
  ffmpeg.on('log', ({ message }) => console.log('[ffmpeg-subtitle]', message))

  const baseURL = '/ffmpeg'
  const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript')
  const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')

  const loadPromise = ffmpeg.load({ coreURL, wasmURL })
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('ffmpeg 加载超时（30秒）')), 30000)
  })
  await Promise.race([loadPromise, timeoutPromise])

  ffmpegInstance = ffmpeg
  return ffmpeg
}

/** 将 dataUrl 的 base64 部分解码为 Uint8Array（ffmpeg writeFile 需要） */
function dataUrlToUint8(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || ''
  const binStr = atob(base64)
  const bytes = new Uint8Array(binStr.length)
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
  return bytes
}

/**
 * 把对白字幕烧录到一段视频底部居中位置。
 * @param videoUrl 远程或本地 blob URL
 * @param dialogue 字幕文本（中文为主），空字符串则不做任何处理返回 null
 * @param resolution 视频分辨率，用于 PNG 字号缩放
 * @returns 合成完毕的新视频 Blob URL；失败/无字幕时返回 null（调用方应回退到原 videoUrl）
 */
export async function burnSubtitleToVideo(
  videoUrl: string,
  dialogue: string,
  resolution: '720p' | '1080p'
): Promise<string | null> {
  const text = (dialogue || '').trim()
  if (!text) return null

  try {
    const ffmpeg = await getFFmpeg()
    const scale = resolutionToScale(resolution)

    // 1) 渲染字幕 PNG
    const rendered = renderSubtitleToPng(text, scale)
    if (!rendered) return null

    // 2) 写入主视频和字幕 PNG
    const ts = Date.now()
    const inputName = `in_${ts}.mp4`
    const subtitleName = `sub_${ts}.png`
    const outputName = `out_${ts}.mp4`

    const videoBytes = await fetchFile(videoUrl)
    await ffmpeg.writeFile(inputName, videoBytes)
    await ffmpeg.writeFile(subtitleName, dataUrlToUint8(rendered.pngDataUrl))

    // 3) 构造 ffmpeg 命令：底部居中 overlay
    const xy = subtitleFFmpegXY()
    const filterComplex = `[0:v][1:v]overlay=x=${xy.x}:y=${xy.y}[vout]`

    const args = [
      '-i', inputName,
      '-i', subtitleName,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-map', '0:a?', // 音轨可选
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'copy',
      '-pix_fmt', 'yuv420p',
      outputName,
    ]

    await ffmpeg.exec(args)

    // 4) 读取输出
    const outData = await ffmpeg.readFile(outputName)
    const blob = new Blob([outData], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)

    // 5) 清理虚拟文件系统
    try { await ffmpeg.deleteFile(inputName) } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(subtitleName) } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(outputName) } catch { /* ignore */ }

    return url
  } catch (e) {
    console.error('[burnSubtitleToVideo] 烧录失败:', e)
    return null
  }
}
