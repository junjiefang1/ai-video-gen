/**
 * 使用 ffmpeg.wasm 在浏览器端拼接多个视频片段
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null

async function getFFmpeg(onProgress?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance
  }
  onProgress?.('正在加载 ffmpeg 引擎...')
  const ffmpeg = new FFmpeg()

  // 监听日志以便调试
  ffmpeg.on('log', ({ message }) => {
    console.log('[ffmpeg]', message)
  })

  // 使用 toBlobURL 将本地文件转为 Blob URL
  // 这样 Worker 内部不需要再发起网络请求，避免 CORS/COEP 问题
  const baseURL = '/ffmpeg'
  const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript')
  const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')

  // 带超时的加载，防止永久挂起
  const loadPromise = ffmpeg.load({ coreURL, wasmURL })
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('ffmpeg 加载超时（30秒），请刷新页面重试')), 30000)
  })

  await Promise.race([loadPromise, timeoutPromise])

  ffmpegInstance = ffmpeg
  return ffmpeg
}

export interface ConcatProgress {
  phase: 'loading' | 'downloading' | 'processing' | 'done'
  percent: number
  message: string
}

/**
 * 下载并拼接多个视频URL为一个MP4文件
 * @returns Blob URL of the concatenated video
 */
export async function concatenateVideos(
  videoUrls: string[],
  onProgress?: (p: ConcatProgress) => void
): Promise<string> {
  onProgress?.({ phase: 'loading', percent: 0, message: '正在加载 ffmpeg 引擎...' })

  const ffmpeg = await getFFmpeg((msg) => {
    onProgress?.({ phase: 'loading', percent: 5, message: msg })
  })

  onProgress?.({ phase: 'loading', percent: 10, message: 'ffmpeg 就绪，开始下载片段...' })

  // 下载所有视频文件
  const fileNames: string[] = []
  for (let i = 0; i < videoUrls.length; i++) {
    const fileName = `segment_${i}.mp4`
    onProgress?.({
      phase: 'downloading',
      percent: 10 + Math.round(((i + 1) / videoUrls.length) * 50),
      message: `下载片段 ${i + 1}/${videoUrls.length}...`,
    })

    const fileData = await fetchFile(videoUrls[i])
    await ffmpeg.writeFile(fileName, fileData)
    fileNames.push(fileName)
  }

  // 创建 concat 列表文件
  const concatList = fileNames.map(f => `file '${f}'`).join('\n')
  await ffmpeg.writeFile('list.txt', new TextEncoder().encode(concatList))

  onProgress?.({ phase: 'processing', percent: 70, message: '正在拼接视频...' })

  // 执行拼接（-c copy 流拷贝，不重新编码，秒级完成）
  await ffmpeg.exec([
    '-f', 'concat',
    '-safe', '0',
    '-i', 'list.txt',
    '-c', 'copy',
    'output.mp4',
  ])

  onProgress?.({ phase: 'processing', percent: 90, message: '正在导出...' })

  // 读取输出文件
  const outputData = await ffmpeg.readFile('output.mp4')
  const blob = new Blob([outputData], { type: 'video/mp4' })
  const url = URL.createObjectURL(blob)

  // 清理
  for (const f of fileNames) {
    await ffmpeg.deleteFile(f)
  }
  await ffmpeg.deleteFile('list.txt')
  await ffmpeg.deleteFile('output.mp4')

  onProgress?.({ phase: 'done', percent: 100, message: '拼接完成' })

  return url
}
