/**
 * 视频尾帧抽取工具
 *
 * 用途：长视频生成时把上一段的尾帧作为下一段的 i2v 首帧，实现段间画面无缝衔接。
 *
 * 关键点：
 * - 阿里云 OSS 视频 URL 直接给 <video> 元素时，canvas.toDataURL 会被 CORS 污染
 * - 解决：fetch → blob → URL.createObjectURL → 给 video 元素，避 CORS
 * - 设置 video.currentTime 到 duration - 0.05s 取最后一帧
 */

/**
 * 从远程视频 URL 抽取最后一帧，返回 base64 jpeg dataUrl
 * 失败返回 null（调用方应回退到原有 routeMode）
 */
export async function extractLastFrame(videoUrl: string, timeoutMs = 20000): Promise<string | null> {
  let blobUrl: string | null = null
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true

  try {
    // 1) 下载视频为 blob，规避 CORS（直接 video.src=远程URL 会让 toDataURL 抛 SecurityError）
    const res = await fetch(videoUrl)
    if (!res.ok) return null
    const blob = await res.blob()
    blobUrl = URL.createObjectURL(blob)
    video.src = blobUrl

    // 2) 等元数据加载
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('metadata timeout')), timeoutMs)
      video.onloadedmetadata = () => { clearTimeout(t); resolve() }
      video.onerror = () => { clearTimeout(t); reject(new Error('video error')) }
    })

    // 3) seek 到接近最后一帧
    const seekTo = Math.max(0, video.duration - 0.05)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('seek timeout')), timeoutMs)
      video.onseeked = () => { clearTimeout(t); resolve() }
      video.onerror = () => { clearTimeout(t); reject(new Error('seek error')) }
      video.currentTime = seekTo
    })

    // 4) 画到 canvas 取 dataUrl
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return null
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)
    // jpeg + 0.85 压缩，base64 体积控制在 ~150KB 内（720p 下）
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    return dataUrl
  } catch {
    return null
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    video.src = ''
    video.removeAttribute('src')
    video.load()
  }
}
