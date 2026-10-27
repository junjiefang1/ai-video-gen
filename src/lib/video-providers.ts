/**
 * 视频生成模型 Provider 抽象层。
 * 当前支持：HappyHorse 1.1 (阿里云 DashScope) / Kling V3 Omni (MuleRouter) / Muledance 2.0 (MuleRouter)。
 *
 * 设计原则：
 * - capabilities 元数据声明每个模型的能力，UI 据此控制控件启用/灰掉
 * - submit/queryTask 通过 dispatch 函数路由到对应 adapter
 * - MuleRouter 系列模型走统一聚合代理 https://38gba5w4.mule.page
 *   - 无需 API Key（代理已配置鉴权）
 *   - 通过 model 字段区分 Kling / Muledance / 各种子模式（T2V/I2V/R2V）
 *   - taskId 编码格式 `<model>::<task_id>` 以便 queryTask 还原 model
 */

import {
  submitTextToVideo as submitT2V_HappyHorse,
  submitImageToVideo as submitI2V_HappyHorse,
  queryTask as queryTask_HappyHorse,
  type TaskResult,
} from './api'

export type ProviderId = 'happyhorse' | 'kling-v3-omni' | 'muledance-2.0'

const MULEROUTER_BASE = '/mulerouter'

/**
 * 视频模型能力矩阵。UI 根据这些字段控制控件的启用/禁用、上限值、提示文案。
 */
export interface VideoCapabilities {
  // 基础生成能力
  supportT2V: boolean // 文生视频
  supportI2V: boolean // 图生视频（首帧）

  // 高级输入能力
  multiRefImagesMax: number // 支持的多参考图最大张数（≥2 表示支持 R2V/Ref2V）
  refVideosMax: number // 支持的参考视频最大段数
  refAudiosMax: number // 支持的参考音频最大段数

  // 高级生成能力
  multiShot: boolean // 单次生成多镜头（Kling 独有）
  nativeAudio: boolean // 原生音效/对白生成
  firstLastFrameLock: boolean // 首尾帧硬锁定（Seedance 独有，区别于 HappyHorse 的链式衔接）
  characterLock: boolean // 主角一致性锁定（i2v + 主角图）
  klingMode: boolean // Kling std/pro 模式切换支持

  // 参数能力
  resolutions: Array<'480p' | '720p' | '1080p'>
  durationsPerSegment: number[] // 单段时长可选项（秒）
  multiLanguageNative: boolean // 原生多语言提示词理解

  // 其他
  textRenderingChinese: 'garbled' | 'partial' | 'good' // 中文字符渲染表现
  pricingTier: 'low' | 'mid' | 'high' // 价格档位（用于 UI 提示）
}

/**
 * Provider 元数据：UI 显示用 + 调度用
 */
export interface ProviderMeta {
  id: ProviderId
  displayName: string
  shortName: string
  description: string
  scenarios: string // 适合场景一句话总结
  capabilities: VideoCapabilities
  apiKeyHint: string // API Key 来源提示
  configured: boolean // adapter 是否已实现真实 API 调用
  needsApiKey: boolean // 是否需要 UI 提供 API Key（MuleRouter 代理无需 Key）
  maxConcurrency: number // 推荐最大并发数（MuleRouter 类建议 ≤2，避免被限流丢连接）
  submitStaggerMs: number // 多任务提交间 stagger 延时（毫秒），避免瞬间并发打满
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  'happyhorse': {
    id: 'happyhorse',
    displayName: 'HappyHorse 1.1 (轻量快速)',
    shortName: 'HappyHorse',
    description: '阿里云轻量快速型，低成本单镜头基础生成',
    scenarios: '动态分镜 / 社媒预热 / 批量背景素材',
    capabilities: {
      supportT2V: true,
      supportI2V: true,
      multiRefImagesMax: 1,
      refVideosMax: 0,
      refAudiosMax: 0,
      multiShot: false,
      nativeAudio: false,
      firstLastFrameLock: false,
      characterLock: true,
      klingMode: false,
      resolutions: ['720p', '1080p'],
      durationsPerSegment: [5, 10],
      multiLanguageNative: false,
      textRenderingChinese: 'garbled',
      pricingTier: 'low',
    },
    apiKeyHint: '阿里云 DashScope API Key',
    configured: true,
    needsApiKey: true,
    maxConcurrency: 5,
    submitStaggerMs: 500,
  },
  'kling-v3-omni': {
    id: 'kling-v3-omni',
    displayName: 'Kling V3 Omni (专业叙事)',
    shortName: 'Kling',
    description: '可控、多镜头、电影级商业制作',
    scenarios: '品牌 Sizzle Reel / 严格 VI 控制 / 复杂物理交互',
    capabilities: {
      supportT2V: true,
      supportI2V: true,
      multiRefImagesMax: 4,
      refVideosMax: 1,
      refAudiosMax: 0,
      multiShot: true,
      nativeAudio: true,
      firstLastFrameLock: false,
      characterLock: true,
      klingMode: true,
      resolutions: ['720p', '1080p'],
      durationsPerSegment: [5, 10],
      multiLanguageNative: false,
      textRenderingChinese: 'partial',
      pricingTier: 'high',
    },
    apiKeyHint: 'MuleRouter 聚合代理（无需 Key）',
    configured: true,
    needsApiKey: false,
    maxConcurrency: 1,
    submitStaggerMs: 5000,
  },
  'muledance-2.0': {
    id: 'muledance-2.0',
    displayName: 'Muledance 2.0 / Seedance (多模态参考)',
    shortName: 'Muledance',
    description: '极强参考素材驱动 + 音画同步',
    scenarios: '复杂动作复刻 / 无缝循环 LED 屏 / 多语言音画同步',
    capabilities: {
      supportT2V: true,
      supportI2V: true,
      multiRefImagesMax: 9,
      refVideosMax: 3,
      refAudiosMax: 3,
      multiShot: false,
      nativeAudio: true,
      firstLastFrameLock: true,
      characterLock: true,
      klingMode: false,
      resolutions: ['480p', '720p', '1080p'],
      durationsPerSegment: [5, 10, 15],
      multiLanguageNative: true,
      textRenderingChinese: 'good',
      pricingTier: 'mid',
    },
    apiKeyHint: 'MuleRouter 聚合代理（无需 Key）',
    configured: true,
    needsApiKey: false,
    maxConcurrency: 1,
    submitStaggerMs: 5000,
  },
}

export const DEFAULT_PROVIDER: ProviderId = 'happyhorse'

/**
 * 提交参数：跨 provider 通用。adapter 根据自身能力解释/忽略字段。
 */
export interface UnifiedSubmitParams {
  apiKey: string
  prompt: string
  resolution: '480p' | '720p' | '1080p'
  durationSec: number
  language: 'zh' | 'en' | 'yue'
  // i2v 输入
  imageUrl?: string // 主参考图（首帧）。注意：MuleRouter 期望公网 URL，dataURI 可能不支持
  refImageUrls?: string[] // 多参考图（R2V/Ref2V）
  refVideoUrls?: string[] // 参考视频
  refAudioUrls?: string[] // 参考音频
  lastFrameUrl?: string // 尾帧（Seedance 首尾帧锁定）
  // 高级开关
  enableNativeAudio?: boolean // 原生音效（Kling/Muledance）
  enableMultiShot?: boolean // 多镜头（Kling）
  klingMode?: 'std' | 'pro' // Kling 标清/精细模式
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | 'adaptive'
}

/**
 * MuleRouter 提交响应
 */
interface MuleRouterSubmitResp {
  success?: boolean
  task_id?: string
  status?: 'pending' | 'processing' | 'completed' | 'failed'
  model?: string
  data?: unknown
  error?: string
  message?: string
}

/**
 * MuleRouter 查询响应
 */
interface MuleRouterQueryResp {
  success?: boolean
  task_id?: string
  status?: 'pending' | 'processing' | 'completed' | 'failed'
  results?: string[] | null
  data?: unknown
  error?: string
  message?: string
}

/**
 * 解码 MuleRouter 任务的 taskId（格式 `<model>::<uuid>`）
 */
function parseMuleTaskId(taskId: string): { model: string; rawId: string } | null {
  const idx = taskId.indexOf('::')
  if (idx < 0) return null
  return { model: taskId.slice(0, idx), rawId: taskId.slice(idx + 2) }
}

/**
 * 决定 MuleRouter 调用要用哪个具体 model 子枚举
 */
function resolveMuleModel(provider: 'kling-v3-omni' | 'muledance-2.0', params: UnifiedSubmitParams): string {
  const hasRefs =
    (params.refImageUrls && params.refImageUrls.length > 0) ||
    (params.refVideoUrls && params.refVideoUrls.length > 0) ||
    (params.refAudioUrls && params.refAudioUrls.length > 0)
  const hasFirstFrame = !!params.imageUrl

  if (provider === 'kling-v3-omni') {
    if (hasRefs) return 'kling-v3-omni-ref2v'
    if (hasFirstFrame) return 'kling-v3-omni-i2v'
    return 'kling-v3-omni-t2v'
  }
  // muledance-2.0
  if (hasRefs) return 'muledance-2.0-r2v'
  if (hasFirstFrame) return 'muledance-2.0-i2v'
  return 'muledance-2.0-t2v'
}

/**
 * 把 MuleRouter 状态字符串映射到统一 TaskResult.status
 */
function mapMuleStatus(s?: string): TaskResult['status'] {
  switch (s) {
    case 'pending':
      return 'PENDING'
    case 'processing':
      return 'RUNNING'
    case 'completed':
      return 'SUCCEEDED'
    case 'failed':
      return 'FAILED'
    default:
      return 'UNKNOWN'
  }
}

/**
 * 带重试的 fetch 封装（处理网络波动/限流/代理间歇性断连）
 */
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 3,
  delayMs = 5000
): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, options)
      // 429 Too Many Requests → 自动重试
      if (resp.status === 429 && attempt < maxRetries) {
        console.warn(`[MuleRouter] 429 限流，第${attempt + 1}次重试，等待${delayMs * (attempt + 1)}ms...`)
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
        continue
      }
      // 502/503/504 也重试（代理或上游临时异常）
      if ([502, 503, 504].includes(resp.status) && attempt < maxRetries) {
        console.warn(`[MuleRouter] HTTP ${resp.status}，第${attempt + 1}次重试...`)
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
        continue
      }
      return resp
    } catch (e) {
      lastErr = e
      console.warn(`[MuleRouter] fetch 异常 (attempt ${attempt + 1}/${maxRetries + 1}):`, e)
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
        continue
      }
    }
  }
  throw lastErr
}

/**
 * 调用 MuleRouter /api/generate 提交任务（含自动重试）
 */
async function submitMuleRouter(
  provider: 'kling-v3-omni' | 'muledance-2.0',
  params: UnifiedSubmitParams
): Promise<TaskResult> {
  const model = resolveMuleModel(provider, params)

  // 多语言提示词附加（Muledance 原生支持，Kling 需要在 prompt 末尾给出语言提示）
  const promptWithLang = appendLangHint(params.prompt, params.language)

  // 时长 clamp 到 [3, 15]
  const duration = Math.max(3, Math.min(15, params.durationSec))

  // 构造 body
  const body: Record<string, unknown> = {
    model,
    prompt: promptWithLang,
    duration,
    aspect_ratio: params.aspectRatio || 'adaptive',
  }

  // resolution: Muledance 全档；Kling 接受 720p/1080p
  if (params.resolution) {
    body.resolution = params.resolution === '480p' && provider === 'kling-v3-omni' ? '720p' : params.resolution
  }

  // sound: 原生音效开关 → on/off
  if (params.enableNativeAudio !== undefined) {
    body.sound = params.enableNativeAudio ? 'on' : 'off'
  }

  // mode: Kling 独有
  if (provider === 'kling-v3-omni' && params.klingMode) {
    body.mode = params.klingMode
  }

  // 首帧/尾帧（MuleRouter 只接受公网 HTTP(S) URL，不接受 base64 data URI）
  // 如果是 base64，自动降级为 t2v（丢弃图片，只走文生）
  const isHttpUrl = (url?: string) => !!url && /^https?:\/\//i.test(url)
  if (params.imageUrl && (model.endsWith('-i2v') || model.endsWith('-r2v') || model.endsWith('-ref2v'))) {
    if (isHttpUrl(params.imageUrl)) {
      // MuleRouter i2v 端点期望的参数名是 'image'（不是 first_frame_image）
      body.image = params.imageUrl
    } else {
      // base64 / data URI → 降级为 t2v 模式
      console.warn('[MuleRouter] image 是 base64，自动降级为 T2V')
      // 修改 model 为 t2v
      const t2vModel = model.replace(/-i2v$/, '-t2v').replace(/-r2v$/, '-t2v').replace(/-ref2v$/, '-t2v')
      body.model = t2vModel
    }
  }
  // 尾帧硬锁：Seedance/Muledance 的 last_frame_image 在 t2v / i2v / r2v 模式下均可用
  if (params.lastFrameUrl && isHttpUrl(params.lastFrameUrl)) {
    body.last_frame_image = params.lastFrameUrl
  }

  // R2V/Ref2V 多模态参考
  if (params.refImageUrls && params.refImageUrls.length > 0) {
    body.images = params.refImageUrls.slice(0, 9)
  }
  if (params.refVideoUrls && params.refVideoUrls.length > 0) {
    body.videos = params.refVideoUrls.slice(0, 3)
  }
  if (params.refAudioUrls && params.refAudioUrls.length > 0) {
    body.audios = params.refAudioUrls.slice(0, 3)
  }

  let resp: Response
  try {
    resp = await fetchWithRetry(`${MULEROUTER_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return {
      taskId: '',
      status: 'FAILED',
      message: `网络错误（已重试2次仍失败）：${e instanceof Error ? e.message : String(e)}。请确认已重启 dev server 使 /mulerouter 代理生效。`,
    }
  }

  let json: MuleRouterSubmitResp = {}
  try {
    json = await resp.json()
  } catch {
    return {
      taskId: '',
      status: 'FAILED',
      message: `MuleRouter 响应非 JSON（HTTP ${resp.status}）`,
    }
  }

  if (!resp.ok || json.success === false || !json.task_id) {
    // 安全序列化：error/message 可能是 object 而非 string
    const rawErr = json.error || json.message || json.data
    const msg = typeof rawErr === 'string' ? rawErr
      : rawErr ? JSON.stringify(rawErr, null, 0).slice(0, 300)
      : `HTTP ${resp.status}`
    console.warn(`[MuleRouter] 提交失败，完整响应:`, json, `\nbody:`, body)
    return { taskId: '', status: 'FAILED', message: `[${PROVIDERS[provider].shortName}] 提交失败：${msg}` }
  }

  // 把 model 编码到 taskId 中，方便后续 queryTask 还原
  return {
    taskId: `${model}::${json.task_id}`,
    status: mapMuleStatus(json.status) || 'PENDING',
  }
}

/**
 * 调用 MuleRouter /api/task/{model}/{task_id} 查询任务（含重试）
 */
async function queryMuleRouter(taskId: string): Promise<TaskResult> {
  const parsed = parseMuleTaskId(taskId)
  if (!parsed) {
    return { taskId, status: 'FAILED', message: 'taskId 格式错误（缺少 model 前缀）' }
  }

  let resp: Response
  try {
    resp = await fetchWithRetry(`${MULEROUTER_BASE}/api/task/${parsed.model}/${parsed.rawId}`, undefined, 1, 5000)
  } catch (e) {
    return {
      taskId,
      status: 'UNKNOWN',
      message: `查询网络错误：${e instanceof Error ? e.message : String(e)}`,
    }
  }

  let json: MuleRouterQueryResp = {}
  try {
    json = await resp.json()
  } catch {
    return { taskId, status: 'UNKNOWN', message: `查询响应非 JSON（HTTP ${resp.status}）` }
  }

  const status = mapMuleStatus(json.status)
  if (status === 'SUCCEEDED') {
    const rawUrl = json.results && json.results.length > 0 ? json.results[0] : undefined
    if (!rawUrl) {
      return { taskId, status: 'FAILED', message: '任务完成但未返回视频 URL' }
    }
    // MuleRouter 返回的视频 URL（字节跳动/Volc CDN）通常无 CORS 头，浏览器无法直接 fetch。
    // 包装成 dev server 的 /proxy-fetch 中间件 URL，由 Node 层中转避免跨域。
    const videoUrl = wrapWithProxyFetch(rawUrl)
    return { taskId, status, videoUrl }
  }
  if (status === 'FAILED') {
    // 把完整上游返回打到 console，便于定位具体原因（如 base64 被拒 / prompt 效验 / 资源不足等）
    console.warn('[MuleRouter] 任务失败，taskId=', taskId, ' 完整响应=', json)
    const detail = json.error || json.message ||
      (typeof json.data === 'string' ? json.data : json.data ? JSON.stringify(json.data) : '') ||
      `任务失败 (HTTP ${resp.status}，原始响应: ${JSON.stringify(json).slice(0, 200)})`
    return { taskId, status, message: detail }
  }
  return { taskId, status }
}

/**
 * 把第三方 CDN 视频 URL 包装成 dev server 同源代理 URL，绕过浏览器 CORS。
 * 仅对 http(s) 远程 URL 生效；data: / blob: / 同源相对路径直接返回。
 */
export function wrapWithProxyFetch(url: string): string {
  if (!url) return url
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  if (url.startsWith('/')) return url // 已是同源相对路径
  if (!/^https?:\/\//i.test(url)) return url
  // 已经是代理 URL 的不重复包装
  if (url.includes('/proxy-fetch?url=')) return url
  return `/proxy-fetch?url=${encodeURIComponent(url)}`
}

/**
 * 把语言指令拼到 prompt 前后（前后夹击加强权重，避免模型忽略语言偏好）。
 * 前缀用强制系统指令格式，后缀用自然语言补充。
 */
function appendLangHint(prompt: string, language: 'zh' | 'en' | 'yue'): string {
  if (language === 'zh') return prompt
  if (language === 'en') {
    return `[Language: English. All speech, dialogue and narration MUST be in English.]\n${prompt}\n[Reminder: Use English for all audio/dialogue.]`
  }
  if (language === 'yue') {
    return `[语言：粤语/广东话。所有对白、旁白、讲解必须使用粤语，禁止使用普通话。]\n${prompt}\n[重要提醒：本视频所有语音必须为粤语（广东话），不可使用普通话或其他语言。Cantonese only, no Mandarin.]`
  }
  return prompt
}

/**
 * 提交视频生成任务，按 provider 路由到对应 adapter。
 */
export async function submitVideoTask(
  provider: ProviderId,
  params: UnifiedSubmitParams
): Promise<TaskResult> {
  switch (provider) {
    case 'happyhorse': {
      // HappyHorse 走原有 api.ts；resolution 480p 不支持时回退到 720p
      const res = (params.resolution === '480p' ? '720p' : params.resolution) as '720p' | '1080p'
      if (params.imageUrl) {
        return submitI2V_HappyHorse(params.apiKey, {
          prompt: params.prompt,
          imageUrl: params.imageUrl,
          resolution: res,
          duration: params.durationSec,
          language: params.language,
        })
      }
      return submitT2V_HappyHorse(params.apiKey, {
        prompt: params.prompt,
        resolution: res,
        duration: params.durationSec,
        language: params.language,
      })
    }
    case 'kling-v3-omni':
    case 'muledance-2.0':
      return submitMuleRouter(provider, params)
    default:
      return {
        taskId: '',
        status: 'FAILED',
        message: `未知 provider: ${provider}`,
      }
  }
}

/**
 * 查询任务状态，按 provider 路由。
 */
export async function queryVideoTask(
  provider: ProviderId,
  apiKey: string,
  taskId: string
): Promise<TaskResult> {
  switch (provider) {
    case 'happyhorse':
      return queryTask_HappyHorse(apiKey, taskId)
    case 'kling-v3-omni':
    case 'muledance-2.0':
      return queryMuleRouter(taskId)
    default:
      return { taskId, status: 'FAILED', message: `未知 provider: ${provider}` }
  }
}

/**
 * 工具函数：判断当前模型是否支持某个分辨率
 */
export function supportsResolution(provider: ProviderId, res: '480p' | '720p' | '1080p'): boolean {
  return PROVIDERS[provider].capabilities.resolutions.includes(res)
}

/**
 * 工具函数：判断当前模型是否支持某个时长
 */
export function supportsDuration(provider: ProviderId, dur: number): boolean {
  return PROVIDERS[provider].capabilities.durationsPerSegment.includes(dur)
}
