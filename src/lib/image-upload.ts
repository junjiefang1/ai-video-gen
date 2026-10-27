/**
 * 图床中转：把本地图片上传到公网，拿到 MuleRouter 可访问的 HTTP(S) URL。
 *
 * 当前支持两种后端：
 * 1. 本地 Vite dev server 的 /upload-to-oss（推荐）：图片传到阿里云 OSS，凭据存在 .env.local，不会暴露到前端。
 * 2. ImgBB (https://api.imgbb.com/)：需要前端配置 API Key，适合没有 OSS 的场景。
 */

export interface UploadResult {
  url: string
  deleteUrl?: string
}

/**
 * 通用文件转 base64
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 上传图片到本地 dev server 的 /upload-to-oss 接口，由 Node 端转发到阿里云 OSS。
 * 不需要前端配置任何 key，OSS 凭据从 .env.local 读取。
 */
export async function uploadImageToOSS(file: File): Promise<UploadResult> {
  const base64 = await fileToBase64(file)

  const resp = await fetch('/upload-to-oss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  })

  const data = await resp.json().catch(() => ({}))

  if (!resp.ok || !data.url) {
    throw new Error(data.error || `OSS 上传失败 (HTTP ${resp.status})`)
  }

  return { url: data.url }
}

/**
 * 上传图片文件到 ImgBB，返回公网 URL。
 * @param file 本地图片文件
 * @param apiKey ImgBB API Key
 */
export async function uploadImageToImgBB(file: File, apiKey: string): Promise<UploadResult> {
  if (!apiKey.trim()) {
    throw new Error('缺少 ImgBB API Key')
  }

  const base64 = await fileToBase64(file)
  // ImgBB API 要求去掉 data:image/jpeg;base64, 前缀
  const base64Data = base64.split(',')[1]

  const form = new FormData()
  form.append('image', base64Data)

  const resp = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    body: form,
  })

  const data = await resp.json().catch(() => ({}))

  if (!resp.ok || !data.success) {
    const msg = data?.error?.message || `上传失败 (HTTP ${resp.status})`
    throw new Error(msg)
  }

  const url = data.data?.url
  if (!url) {
    throw new Error('ImgBB 未返回图片 URL')
  }

  return {
    url,
    deleteUrl: data.data?.delete_url,
  }
}

/**
 * 自动选择上传后端：优先 OSS 中转，失败时回退 ImgBB（如果配置了 key）。
 */
export async function uploadImage(file: File, imgbbKey?: string): Promise<UploadResult> {
  // 先尝试 OSS 中转（零配置前端，凭据在 dev server）
  try {
    return await uploadImageToOSS(file)
  } catch (err) {
    // OSS 未配置或失败，且有 ImgBB key 时回退
    if (imgbbKey) {
      return uploadImageToImgBB(file, imgbbKey)
    }
    throw err
  }
}

/**
 * 校验一个 URL 是否是公网 HTTP(S) URL（MuleRouter 可接受）
 */
export function isPublicHttpUrl(url?: string): boolean {
  return !!url && /^https?:\/\//i.test(url) && !url.startsWith('http://localhost') && !url.startsWith('http://127.')
}
