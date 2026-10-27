import { useState, useCallback, useRef, useEffect } from 'react'
import { SceneSegment, decomposePromptToScenes } from '@/lib/prompt-decompose'
import {
  submitVideoTask,
  queryVideoTask,
  PROVIDERS,
  DEFAULT_PROVIDER,
  type ProviderId,
} from '@/lib/video-providers'
import { uploadImage, isPublicHttpUrl } from '@/lib/image-upload'
import { extractLastFrame } from '@/lib/video-frame'
// import { burnSubtitleToVideo } from '@/lib/video-text-overlay' // 字幕烧录已禁用
import { concatenateVideos, ConcatProgress } from '@/lib/video-concat'
import { PromptRewriteSection } from '@/components/PromptRewriteSection'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Film, Wand2, Download, Play, Loader2, Sparkles, Check, Pencil, ImagePlus, X, User, Upload } from 'lucide-react'

type LongVideoPhase = 'config' | 'rewriting' | 'decomposing' | 'review-scenes' | 'generating' | 'concatenating' | 'done' | 'error'

interface SegmentStatus {
  segment: SceneSegment
  status: 'queued' | 'submitted' | 'running' | 'done' | 'failed'
  taskId?: string
  videoUrl?: string
  error?: string
  imageUrl?: string // 绑定的图片（Data URL）
  // 路由模式：i2v=用参考图作首帧走图生视频；t2v=丢参考图走文生视频。
  // 默认由拆解 AI 根据 hasDenseText 决定，用户可在 review 阶段手动覆盖。
  routeMode: 'i2v' | 't2v'
  routeReason?: string // VL 判断说明，在 UI 提示为什么当前是 t2v
  tailFrameUrl?: string // 本段生成后抽取的尾帧 dataUrl，作下一段 i2v 首帧（启用链式衔接时）
}

interface LongVideoPanelProps {
  apiKey: string
  imgbbKey: string
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void
}

// === 持久化：切换 Quest / 刷新后恢复状态 ===
// 使用 localStorage（跨上下文/刷新持久）+ IndexedDB（存视频二进制）
const STORAGE_KEY = 'ai-video-gen-session'
const IDB_NAME = 'ai-video-gen-db'
const IDB_STORE = 'videos'
const IDB_FINAL_KEY = 'final-video'

interface PersistedState {
  phase: LongVideoPhase
  prompt: string
  globalStyle: string
  segments: SegmentStatus[]
  finalVideoUrl: string | null // 仅标记有无最终视频，实际 blob 存 IndexedDB
  selectedProvider: ProviderId
  resolution: '480p' | '720p' | '1080p'
  language: 'zh' | 'en' | 'yue'
  durationHours: number
  durationMinutes: number
  durationSeconds: number
  segmentDuration: number
  errorMessage: string
  enableFirstLastFrameLock: boolean
  lastFramePublicUrl: string
}

function toStringSafe(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function loadPersistedState(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)

    // 严格校验：prompt/globalStyle/errorMessage 必须是 string，否则说明数据已损坏
    const isValidString = (v: unknown) => typeof v === 'string'
    if (parsed.prompt !== undefined && !isValidString(parsed.prompt)) {
      console.warn('[LongVideoPanel] 检测到损坏的 prompt 数据，已重置会话')
      localStorage.removeItem(STORAGE_KEY)
      return {}
    }
    if (parsed.globalStyle !== undefined && !isValidString(parsed.globalStyle)) {
      console.warn('[LongVideoPanel] 检测到损坏的 globalStyle 数据，已重置会话')
      localStorage.removeItem(STORAGE_KEY)
      return {}
    }
    if (parsed.errorMessage !== undefined && !isValidString(parsed.errorMessage)) {
      parsed.errorMessage = toStringSafe(parsed.errorMessage)
    }

    if (Array.isArray(parsed.segments)) {
      parsed.segments = parsed.segments.map((s: any) => ({
        ...s,
        segment: s.segment ? {
          ...s.segment,
          prompt: typeof s.segment?.prompt === 'string' ? s.segment.prompt : toStringSafe(s.segment?.prompt),
          dialogue: typeof s.segment?.dialogue === 'string' ? s.segment.dialogue : undefined,
        } : s.segment,
        error: typeof s.error === 'string' ? s.error : s.error ? toStringSafe(s.error) : undefined,
      }))
    }
    return parsed
  } catch {
    return {}
  }
}

function savePersistedState(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage 满或不可用时静默忽略
  }
}

// --- IndexedDB 工具：存取视频 Blob ---
function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveVideoBlob(blob: Blob): Promise<void> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(blob, IDB_FINAL_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function loadVideoBlob(): Promise<Blob | null> {
  try {
    const db = await openIDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(IDB_FINAL_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

async function clearVideoBlob(): Promise<void> {
  try {
    const db = await openIDB()
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(IDB_FINAL_KEY)
  } catch { /* ignore */ }
}

export function LongVideoPanel({ apiKey, imgbbKey, showToast }: LongVideoPanelProps) {
  // 初始化时从 sessionStorage 恢复
  const [persisted] = useState(() => loadPersistedState())

  const [prompt, setPrompt] = useState(toStringSafe(persisted.prompt))
  const [durationHours, setDurationHours] = useState(persisted.durationHours ?? 0)
  const [durationMinutes, setDurationMinutes] = useState(persisted.durationMinutes ?? 1)
  const [durationSeconds, setDurationSeconds] = useState(persisted.durationSeconds ?? 0) // 步进5秒
  const [segmentDuration, setSegmentDuration] = useState(persisted.segmentDuration ?? 5)
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>(persisted.resolution || '720p')
  const [concurrency, setConcurrency] = useState(2)
  // 链式衔接：开启后上段尾帧作下段 i2v 首帧，段间画面连续。启用后必须串行执行（不能并发）
  const [chainFrames, setChainFrames] = useState(false)
  // 视频生成模型选择（HappyHorse / Kling V3 Omni / Muledance 2.0）。能力差异由 PROVIDERS 矩阵驱动 UI。
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(persisted.selectedProvider || DEFAULT_PROVIDER)
  // 原生音效：Kling/Muledance 支持，HappyHorse 不支持（灰掉）
  const [enableNativeAudio, setEnableNativeAudio] = useState(false)
  // 多镜头单次生成：Kling 独有
  const [enableMultiShot, setEnableMultiShot] = useState(false)
  // 首尾帧硬锁：Muledance/Seedance 独有，需要公网 URL
  const [enableFirstLastFrameLock, setEnableFirstLastFrameLock] = useState(persisted.enableFirstLastFrameLock ?? false)
  const [lastFramePublicUrl, setLastFramePublicUrl] = useState(toStringSafe(persisted.lastFramePublicUrl))
  const [uploadingLastFrame, setUploadingLastFrame] = useState(false)
  const [showRewrite, setShowRewrite] = useState(false)
  const [rewriteImageDataUrls, setRewriteImageDataUrls] = useState<string[]>([])
  const [imagePool, setImagePool] = useState<{ id: string; dataUrl: string; name: string; publicUrl?: string }[]>([])
  const [protagonist, setProtagonist] = useState<{ dataUrl: string; name: string; publicUrl?: string } | null>(null)
  const [language, setLanguage] = useState<'zh' | 'en' | 'yue'>(persisted.language || 'yue')

  const [phase, setPhase] = useState<LongVideoPhase>(persisted.phase || 'config')
  const [globalStyle, setGlobalStyle] = useState(toStringSafe(persisted.globalStyle))
  const [segments, setSegments] = useState<SegmentStatus[]>(persisted.segments || [])
  const [editingSceneIdx, setEditingSceneIdx] = useState<number | null>(null)
  const [concatProgress, setConcatProgress] = useState<ConcatProgress | null>(null)
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(persisted.finalVideoUrl || null)
  const [errorMessage, setErrorMessage] = useState(toStringSafe(persisted.errorMessage))

  const abortRef = useRef(false)

  // 状态变化时自动持久化到 localStorage
  useEffect(() => {
    // 只在有实质内容时保存（避免空状态覆盖有效数据）
    if (phase === 'config' && !prompt && segments.length === 0) return
    savePersistedState({
      phase,
      prompt,
      globalStyle,
      segments,
      // 存标记而非实际 blob URL（blob URL 跨刷新无效，实际数据存 IndexedDB）
      finalVideoUrl: finalVideoUrl ? '__has_video__' : null,
      selectedProvider,
      resolution,
      language,
      durationHours,
      durationMinutes,
      durationSeconds,
      segmentDuration,
      errorMessage,
      enableFirstLastFrameLock,
      lastFramePublicUrl,
    })
  }, [phase, prompt, globalStyle, segments, finalVideoUrl, selectedProvider, resolution, language, durationHours, durationMinutes, durationSeconds, segmentDuration, errorMessage, enableFirstLastFrameLock, lastFramePublicUrl])

  // 恢复时修正不合理的中间状态 + 从 IndexedDB 恢复视频 blob
  useEffect(() => {
    // 修正中间状态
    if (persisted.phase === 'generating' || persisted.phase === 'concatenating' || persisted.phase === 'rewriting' || persisted.phase === 'decomposing') {
      if (persisted.finalVideoUrl) {
        setPhase('done')
      } else if (persisted.segments && persisted.segments.some(s => s.videoUrl)) {
        setPhase('review-scenes')
        showToast('之前的生成任务已中断，可重新开始', 'info')
      } else if (persisted.segments && persisted.segments.length > 0) {
        setPhase('review-scenes')
      } else {
        setPhase('config')
      }
    }

    // 从 IndexedDB 恢复最终视频 blob（blob: URL 无法跨刷新存活，必须重建）
    if (persisted.finalVideoUrl) {
      loadVideoBlob().then(blob => {
        if (blob) {
          const newUrl = URL.createObjectURL(blob)
          setFinalVideoUrl(newUrl)
          if (persisted.phase === 'done' || persisted.phase === 'generating' || persisted.phase === 'concatenating') {
            setPhase('done')
          }
        } else {
          // IndexedDB 里没有 blob 了，清除无效标记
          setFinalVideoUrl(null)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalSeconds = durationHours * 3600 + durationMinutes * 60 + durationSeconds
  const segmentCount = Math.ceil(totalSeconds / segmentDuration)

  // 切换模型时，自动修正不兼容的字段（避免不支持的分辨率/时长/能力开关被错误传给 adapter）
  const providerMeta = PROVIDERS[selectedProvider]
  const caps = providerMeta.capabilities
  useEffect(() => {
    // 分辨率不支持 → 回退到该模型支持的第一个
    if (!caps.resolutions.includes(resolution)) {
      setResolution(caps.resolutions[0])
    }
    // 时长不支持 → 回退到第一个
    if (!caps.durationsPerSegment.includes(segmentDuration)) {
      setSegmentDuration(caps.durationsPerSegment[0])
    }
    // 不支持原生音效 → 强制关闭
    if (!caps.nativeAudio && enableNativeAudio) {
      setEnableNativeAudio(false)
    }
    // 不支持多镜头 → 强制关闭
    if (!caps.multiShot && enableMultiShot) {
      setEnableMultiShot(false)
    }
    // MuleRouter 模型不支持链式衔接（尾帧是 base64，无法传给 MuleRouter） → 强制关闭
    if (selectedProvider !== 'happyhorse' && chainFrames) {
      setChainFrames(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider])

  // 开始分镜拆解（可选先改写prompt再拆解）
  const handleDecompose = useCallback(async (finalPrompt?: string) => {
    const p = finalPrompt || prompt
    if (!apiKey) { showToast('请先设置 API Key', 'error'); return }
    if (!p.trim()) { showToast('请输入视频描述', 'error'); return }

    setShowRewrite(false)
    setPhase('decomposing')
    setSegments([])
    setFinalVideoUrl(null)
    clearVideoBlob() // 清除旧的拼接视频
    setErrorMessage('')

    try {
      // 有图片时，先将图片转为 base64 传给拆解器（视觉模型能直接看到图片）
      let imageDataUrls: string[] | undefined
      if (imagePool.length > 0) {
        try {
          imageDataUrls = await Promise.all(imagePool.map(img => blobUrlToBase64(img.dataUrl)))
        } catch {
          imageDataUrls = undefined
        }
      }

      const { globalStyle: gStyle, scenes, imageMetas } = await decomposePromptToScenes(
        apiKey, p, totalSeconds, segmentDuration, imageDataUrls,
        PROVIDERS[selectedProvider].capabilities.textRenderingChinese
      )
      setGlobalStyle(gStyle)
      // 使用 AI 返回的 imageIndex 自动绑定图片，同时根据 imageMetas 决定路由模式
      const statuses: SegmentStatus[] = scenes.map(s => {
        let imageUrl: string | undefined
        let routeMode: 'i2v' | 't2v' = 't2v'
        let routeReason: string | undefined
        if (s.imageIndex !== undefined && s.imageIndex >= 0 && s.imageIndex < imagePool.length) {
          imageUrl = imagePool[s.imageIndex].dataUrl
          // 查看该图的密集文字判断。含密集文字 → 强制走 t2v 避免乱码；干净 → 走 i2v 锁人锁场景
          const meta = imageMetas?.find(m => m.imageIndex === s.imageIndex)
          if (meta?.hasDenseText) {
            routeMode = 't2v'
            routeReason = meta.reason || '参考图含密集文字，走t2v避免乱码'
          } else {
            routeMode = 'i2v'
            routeReason = meta?.reason || '参考图干净，走i2v锁人物锁场景'
          }
        } else {
          // 无参考图 → 只能走 t2v
          routeMode = 't2v'
          routeReason = '未绑定参考图'
        }
        // 从 prompt 中移除 [配图N] 标记（不影响视频生成）
        const cleanPrompt = s.prompt.replace(/\s*\[配图\d+\]\s*/g, '').trim()
        return { segment: { ...s, prompt: cleanPrompt }, status: 'queued', imageUrl, routeMode, routeReason }
      })
      setSegments(statuses)
      setPhase('review-scenes')
      const i2vCount = statuses.filter(s => s.routeMode === 'i2v').length
      const t2vCount = statuses.length - i2vCount
      const msg = i2vCount > 0
        ? `已拆解为 ${scenes.length} 个分镜：${i2vCount} 个走图生视频、${t2vCount} 个走文生视频，请review确认`
        : `已拆解为 ${scenes.length} 个分镜（全部走文生视频），请review后确认生成`
      showToast(msg, 'success')
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '分镜拆解失败')
      setPhase('error')
    }
  }, [apiKey, prompt, totalSeconds, segmentDuration, imagePool, showToast, selectedProvider])

  // 压缩/规范图片：满足 DashScope i2v 限制（短边≥300，宽高比 1:2.5~2.5:1）
  // 策略：短边不足则放大，长边过大则缩小，质量0.6 JPEG，返回 Blob URL
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const origW = img.width
        const origH = img.height
        // 1) 宽高比校验：API 要求 1:2.5 ~ 2.5:1
        const aspect = Math.max(origW, origH) / Math.min(origW, origH)
        if (aspect > 2.5) {
          reject(new Error(`图片宽高比超限：${origW}×${origH}（需在 1:2.5 ~ 2.5:1 之间）`))
          return
        }

        const MIN_SHORT = 480 // 大于 API 要求的 300，留出余量
        const MAX_LONG = 1280
        let width = origW
        let height = origH

        // 2) 短边不足则等比放大
        const shortSide = Math.min(width, height)
        if (shortSide < MIN_SHORT) {
          const s = MIN_SHORT / shortSide
          width = Math.round(width * s)
          height = Math.round(height * s)
        }
        // 3) 长边超限则等比缩小
        const longSide = Math.max(width, height)
        if (longSide > MAX_LONG) {
          const s = MAX_LONG / longSide
          width = Math.round(width * s)
          height = Math.round(height * s)
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        // 高质量缩放（尤其是放大时）
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            canvas.width = 0
            canvas.height = 0
            img.src = ''
            if (blob) {
              resolve(URL.createObjectURL(blob))
            } else {
              reject(new Error('图片压缩失败'))
            }
          },
          'image/jpeg',
          0.6
        )
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('图片加载失败'))
      }
      img.src = url
    })
  }

  // 图片池：添加图片（逐张顺序处理，避免并发解码导致OOM）
  const handleAddToPool = async (files: FileList) => {
    for (const file of Array.from(files)) {
      try {
        const blobUrl = await compressImage(file)
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        setImagePool(prev => [...prev, { id, dataUrl: blobUrl, name: file.name }])
        // 同时上传到 OSS 获取公网 URL
        try {
          const res = await uploadImage(file, imgbbKey)
          setImagePool(prev => prev.map(img => img.id === id ? { ...img, publicUrl: res.url } : img))
        } catch (err) {
          console.warn(`场景参考图 ${file.name} OSS 上传失败:`, err)
        }
      } catch {
        showToast(`图片 ${file.name} 处理失败`, 'error')
      }
    }
  }

  // 将 Blob URL 转为 base64 Data URL（仅在提交API时使用，避免常驻内存）
  const blobUrlToBase64 = (blobUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      fetch(blobUrl)
        .then(res => res.blob())
        .then(blob => {
          const reader = new FileReader()
          reader.onloadend = () => {
            const result = reader.result as string
            // base64 超过 150KB 时提示可能影响成功率（DashScope 图片 URL 有大小限制）
            if (result.length > 150 * 1024) {
              showToast('图片较大，若提交失败请尝试使用更小的图片', 'info')
            }
            resolve(result)
          }
          reader.onerror = () => reject(new Error('Blob转base64失败'))
          reader.readAsDataURL(blob)
        })
        .catch(() => reject(new Error('无法读取图片数据')))
    })
  }

  // === Green net 内容安全审核 自动重试机制 ===

  /** 判断错误是否是阿里云内容安全审核拦截 */
  const isGreenNetError = (err: unknown): boolean => {
    if (typeof err !== 'string') return false
    const lower = err.toLowerCase()
    return lower.includes('green net') ||
           lower.includes('inappropriate content') ||
           lower.includes('content moderation') ||
           lower.includes('content_filter')
  }

  /**
   * 清洗可能被内容安全审核拦截的敏感词。
   * 策略：删除引号内品牌词（最可能触发审核）+ 删除中英文安保相关词汇 + 加无害后缀
   */
  const cleanForGreenNet = (prompt: string): string => {
    let out = prompt
    // 删除所有引号内容（品牌词最容易触发审核，如 "SECURITY"、"云安全" 等）
    out = out.replace(/[\u2018\u2019\u201c\u201d'"\u300c\u300d\u300e\u300f][^\u2018\u2019\u201c\u201d'"\u300c\u300d\u300e\u300f]*[\u2018\u2019\u201c\u201d'"\u300c\u300d\u300e\u300f]/g, '')
    // 删除中英文敏感词（不区分大小写）
    const sensitiveWords = [
      // 中文
      '安保', '安全', '守护', '守卫', '警察', '政府', '军事', '武器', '暴力',
      '死亡', '杀', '血', '战争', '战斗', '战场', '牺牲', '牺牌', '战士',
      '刀', '剑', '枪', '炮', '弹', '爆炸', '爆破', '火药', '炸弹', '导弹',
      '毒品', '赌博', '色情', '裸', '性', '自杀', '恐怖', '恐怖主义',
      '毒', '吞', '探测', '监控', '监视', '监禁', '射击', '射杀',
      '刑罚', '酷刑', '拷打', '虐待', '绑架', '侵略', '屠杀',
      '毒气', '生化', '核武', '核弹',
      // 英文
      'security', 'military', 'weapon', 'government', 'police', 'violence', 'gun',
      'kill', 'murder', 'blood', 'war', 'bomb', 'terror', 'drug', 'nude', 'sex',
      'suicide', 'torture', 'attack', 'assault', 'shoot', 'stab', 'explosion',
      'death', 'dead', 'die', 'destroy', 'destruction',
    ]
    for (const w of sensitiveWords) {
      out = out.replace(new RegExp(w, 'gi'), '')
    }
    // 压缩多余空格
    out = out.replace(/\s+/g, ' ').trim()
    // 添加无害的艺术化后缀，稀释敏感词密度
    return `${out} Cinematic artistic safe content, professional broadcast quality.`
  }

  /**
   * 提交视频生成任务，遇到 Green net 内容审核拦截时自动清洗 prompt 并重试一次。
   * 返回 null 表示被中止（abortRef.current=true）。
   */
  const submitWithGreenNetRetry = async (
    route: 't2v' | 'i2v',
    fullPrompt: string,
    imageUrl: string | undefined,
    segDuration: number,
    lastFrameUrl?: string
  ) => {
    const doSubmit = (p: string) => {
      return submitVideoTask(selectedProvider, {
        apiKey,
        prompt: p,
        resolution,
        durationSec: segDuration,
        language,
        imageUrl: route === 'i2v' ? imageUrl : undefined,
        lastFrameUrl,
        enableNativeAudio,
        enableMultiShot,
      })
    }

    // 首次提交
    const result = await doSubmit(fullPrompt)

    // 检查返回值（HappyHorse 的 API 不 throw，而是返回 FAILED + message）
    if (result.status === 'FAILED' && result.message && isGreenNetError(result.message)) {
      // Green net 拦截 → 清洗敏感词重试一次
      const cleaned = cleanForGreenNet(fullPrompt)
      const retryResult = await doSubmit(cleaned)
      if (retryResult.status === 'FAILED' && retryResult.message && isGreenNetError(retryResult.message)) {
        // 清洗后仍被拦截 → 返回友好提示，并显示 prompt 前80字方便定位
        console.warn('[GreenNet] 清洗后仍被拦截，原始 prompt:', fullPrompt.slice(0, 200))
        console.warn('[GreenNet] 清洗后 prompt:', cleaned.slice(0, 200))
        return {
          ...retryResult,
          message: `内容安全审核拦截（已自动清洗重试仍失败）。请修改 prompt 中可能触发审核的词汇。Prompt片段: "${fullPrompt.slice(0, 80)}..."`,
        }
      }
      return retryResult
    }

    return result
  }

  // 图片池：删除图片
  const handleRemoveFromPool = (id: string) => {
    setImagePool(prev => prev.filter(img => img.id !== id))
  }

  // 用户编辑分镜prompt
  const handleSceneEdit = (idx: number, newPrompt: string) => {
    setSegments(prev => prev.map((s, i) =>
      i === idx ? { ...s, segment: { ...s.segment, prompt: newPrompt } } : s
    ))
  }

  // 绑定图片到分镜（从图片池选择）：默认走 i2v（手动选的图认为是干净可锁人锁场景的）
  const handleBindImageFromPool = (idx: number, dataUrl: string) => {
    setSegments(prev => prev.map((s, i) =>
      i === idx ? { ...s, imageUrl: dataUrl, routeMode: 'i2v', routeReason: '手动绑定参考图，默认走i2v' } : s
    ))
  }

  // 绑定图片到分镜（直接上传，压缩后绑定）
  const handleBindImage = async (idx: number, file: File) => {
    try {
      const blobUrl = await compressImage(file)
      setSegments(prev => prev.map((s, i) =>
        i === idx ? { ...s, imageUrl: blobUrl, routeMode: 'i2v', routeReason: '手动上传参考图，默认走i2v' } : s
      ))
    } catch {
      showToast('图片处理失败', 'error')
    }
  }

  // 解绑图片：同时头车 routeMode 头为 t2v（没参考图了）
  const handleUnbindImage = (idx: number) => {
    setSegments(prev => prev.map((s, i) =>
      i === idx ? { ...s, imageUrl: undefined, routeMode: 't2v', routeReason: '已解绑参考图' } : s
    ))
  }

  // 手动切换路由模式（覆盖 AI 判断）。只有在绑了图的分镜才能切 i2v。
  const handleToggleRouteMode = (idx: number) => {
    setSegments(prev => prev.map((s, i) => {
      if (i !== idx) return s
      if (!s.imageUrl) return s // 没图不能走 i2v
      if (s.routeMode === 'i2v') {
        return { ...s, routeMode: 't2v', routeReason: '手动切为t2v' }
      } else {
        return { ...s, routeMode: 'i2v', routeReason: '手动切为i2v' }
      }
    }))
  }

  // 一键把某张参考图同步到所有未绑图的分镜（保证背景一致，所有段都走 i2v）
  const handleApplyImageToAll = (dataUrl: string) => {
    setSegments(prev => prev.map(s => s.imageUrl ? s : { ...s, imageUrl: dataUrl, routeMode: 'i2v', routeReason: '一键同步参考图' }))
    showToast('已同步到所有未绑图的分镜，全片将走图生视频', 'success')
  }

  // 一键把参考图强制同步到所有分镜（会覆盖已绑定的）
  const handleForceApplyImageToAll = (dataUrl: string) => {
    setSegments(prev => prev.map(s => ({ ...s, imageUrl: dataUrl, routeMode: 'i2v', routeReason: '一键强制同步参考图' })))
    showToast('已强制同步到所有分镜，全片将走图生视频', 'success')
  }

  // 确认分镜，开始生成
  const handleConfirmAndGenerate = useCallback(async () => {
    abortRef.current = false
    setPhase('generating')
    setEditingSceneIdx(null)

    const statuses = [...segments]

    // 单段生成最多重试 MAX_ATTEMPTS 次（包括首次），应对 MuleRouter 上游间歇性失败
    const MAX_ATTEMPTS = 2
    const RETRY_INTERVAL_MS = 8000

    async function processSegment(idx: number) {
      if (abortRef.current) return
      statuses[idx] = { ...statuses[idx], status: 'submitted' }
      setSegments([...statuses])

      let lastError = ''
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (abortRef.current) return
        if (attempt > 1) {
          // 重试前在 UI 上提示，避免用户以为卡住
          statuses[idx] = { ...statuses[idx], status: 'submitted', error: `第 ${attempt}/${MAX_ATTEMPTS} 次尝试（上次失败：${lastError.slice(0, 60)}）` }
          setSegments([...statuses])
          await sleep(RETRY_INTERVAL_MS)
        }
        const outcome = await runSegmentOnce(idx)
        if (outcome.ok) return
        lastError = outcome.error
        // 某些错误不值得重试（如超时已超 15min 、用户主动取消）
        if (outcome.noRetry) break
      }
      // 最终失败：写入 failed 状态 + 详细错误
      statuses[idx] = { ...statuses[idx], status: 'failed', error: `已重试 ${MAX_ATTEMPTS} 次仍失败：${lastError}` }
      setSegments([...statuses])
    }

    // 抽出“单次尝试”：返回 { ok, error, noRetry }
    async function runSegmentOnce(idx: number): Promise<{ ok: boolean; error: string; noRetry?: boolean }> {
      try {
        const seg = statuses[idx]
        // 混合路由：
        // - i2v（参考图干净，无密集文字）：拿参考图作首帧 → 锁人锁场景
        // - t2v（含密集文字的参考图 或 无参考图）：只靠 prompt + globalStyle 人物描述
        // 全局风格锚 globalStyle 总是 prefix，保证人物一致性
        const fullPrompt = globalStyle
          ? `${globalStyle}\n${seg.segment.prompt}`
          : seg.segment.prompt

        // 【链式衔接】：如果启用了链式且上段已抽取到尾帧，本段强制走 i2v 用尾帧作首帧
        // 这会覆盖原 routeMode 和 imageUrl，使画面从上段结尾姿态连续演变。
        const prevTailFrame = chainFrames && idx > 0 ? statuses[idx - 1].tailFrameUrl : undefined
        const isMuleRouter = selectedProvider !== 'happyhorse'
        const isBase64 = (url?: string) => !!url && url.startsWith('data:')

        let route: 't2v' | 'i2v'
        let imageUrl: string | undefined
        if (prevTailFrame && !(isMuleRouter && isBase64(prevTailFrame))) {
          // 用上段尾帧作首帧走 i2v（MuleRouter + base64 时跳过）
          route = 'i2v'
          imageUrl = prevTailFrame
        } else if (protagonist?.dataUrl) {
          // 【主角设定】：有主角图时走 i2v
          if (isMuleRouter) {
            // MuleRouter 模式：用公网 URL
            if (protagonist.publicUrl) {
              route = 'i2v'
              imageUrl = protagonist.publicUrl
            } else {
              // 没有公网 URL 则降级为 t2v
              route = 't2v'
              imageUrl = undefined
            }
          } else {
            // HappyHorse：直接用 base64
            route = 'i2v'
            imageUrl = await blobUrlToBase64(protagonist.dataUrl)
          }
        } else if (seg.routeMode === 'i2v' && seg.imageUrl) {
          // 场景参考图走 i2v
          if (isMuleRouter) {
            // MuleRouter：查找对应 imagePool 中的公羑 URL
            const poolItem = imagePool.find(img => img.dataUrl === seg.imageUrl)
            if (poolItem?.publicUrl) {
              route = 'i2v'
              imageUrl = poolItem.publicUrl
            } else {
              route = 't2v'
              imageUrl = undefined
            }
          } else {
            route = 'i2v'
            imageUrl = await blobUrlToBase64(seg.imageUrl)
          }
        } else {
          // 走文生视频
          route = 't2v'
          imageUrl = undefined
        }

        // 首尾帧硬锁：仅对 Muledance 生效
        // 第一段：用上传的图作为 first_frame_image（锁定开头画面）
        // 最后一段：用上传的图作为 last_frame_image（锁定结尾画面）
        // 实现无缝循环或固定收尾效果
        const shouldUseLock = enableFirstLastFrameLock && isPublicHttpUrl(lastFramePublicUrl) && selectedProvider === 'muledance-2.0'
        const isFirstSegment = idx === 0
        const isLastSegment = idx === statuses.length - 1

        // 首尾帧硬锁：强制走 i2v 模式 + 传对应帧图
        // 第一段：用上传图作为首帧（i2v）
        // 最后一段：也走 i2v（用同一张图做首帧），同时传 last_frame_image 锁定尾帧
        // 注意：MuleRouter t2v 端点不支持 last_frame_image，所以尾帧锁也必须走 i2v
        if (shouldUseLock && isFirstSegment && route === 't2v') {
          route = 'i2v'
          imageUrl = lastFramePublicUrl
        }
        if (shouldUseLock && isLastSegment && !isFirstSegment && route === 't2v') {
          // 最后一段也强制走 i2v，这样 last_frame_image 才能生效
          route = 'i2v'
          imageUrl = lastFramePublicUrl
        }
        const segmentLastFrameUrl = shouldUseLock && isLastSegment ? lastFramePublicUrl : undefined

        // 提交任务（遇到 Green net 内容审核拦截会自动清洗敏感词并重试一次）
        const result = await submitWithGreenNetRetry(route, fullPrompt, imageUrl, seg.segment.durationSec, segmentLastFrameUrl)

        if (!result.taskId) {
          // Green Net 审核拦截 → 不值得外层重试（prompt 不变，结果相同）
          const isContentBlock = isGreenNetError(result.message || '')
          return { ok: false, error: result.message || '提交失败', noRetry: isContentBlock }
        }

        statuses[idx] = { ...statuses[idx], taskId: result.taskId, status: 'running', error: undefined }
        setSegments([...statuses])

        // 轮询查询（MuleRouter 建议 15-30s 间隔，最多轮询 60 次 = 约15分钟超时）
        let pollCount = 0
        const MAX_POLLS = 60
        while (!abortRef.current && pollCount < MAX_POLLS) {
          await sleep(15000)
          pollCount++
          const taskResult = await queryVideoTask(selectedProvider, apiKey, result.taskId)
          if (taskResult.status === 'SUCCEEDED') {
            const finalVideoUrl = taskResult.videoUrl
            // 字幕烧录已禁用：dialogue 是 AI 预写的剧本台词，非语音识别结果，
            // 与视频实际语音不一致，烧录会造成混乱。
            // 如需真正字幕，应接入 ASR 语音识别后再烧录。
            statuses[idx] = { ...statuses[idx], status: 'done', videoUrl: finalVideoUrl, error: undefined }
            setSegments([...statuses])
            // 【链式衔接】：本段生成后抽尾帧作下段首帧。失败不会阻断流程，仅丢失衔接。
            if (chainFrames && idx < statuses.length - 1 && finalVideoUrl) {
              try {
                const tail = await extractLastFrame(finalVideoUrl)
                if (tail) {
                  statuses[idx] = { ...statuses[idx], tailFrameUrl: tail }
                  setSegments([...statuses])
                }
              } catch {
                // 静默失败，下段会回退原 routeMode
              }
            }
            return { ok: true, error: '' }
          } else if (taskResult.status === 'FAILED') {
            return { ok: false, error: taskResult.message || '生成失败' }
          }
        }
        // 轮询超时：不重试（上游可能还在跑，重试可能重复扣费）
        if (pollCount >= MAX_POLLS) {
          return { ok: false, error: '生成超时（超过15分钟未完成）', noRetry: true }
        }
        return { ok: false, error: '已取消', noRetry: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '异常' }
      }
    }

    // 启用链式衍接时必须串行（下段需要上段的尾帧）；否则使用 worker pool 并发
    // 并发数受 provider.maxConcurrency 限制（MuleRouter 类最多2，避免被丢连接）
    const effectiveConcurrency = Math.min(concurrency, providerMeta.maxConcurrency)
    const staggerMs = providerMeta.submitStaggerMs
    
    if (chainFrames) {
      for (let i = 0; i < statuses.length && !abortRef.current; i++) {
        if (i > 0 && staggerMs > 0) await sleep(staggerMs)
        await processSegment(i)
      }
    } else {
      let nextIdx = 0
      async function runWorker() {
        while (nextIdx < statuses.length && !abortRef.current) {
          const idx = nextIdx++
          // stagger: 每个 worker 提交之前延时（除第一个任务外），避免同一时刻所有 worker 同时打出请求
          if (idx > 0 && staggerMs > 0) await sleep(staggerMs)
          await processSegment(idx)
        }
      }
      const workers = Array.from({ length: Math.min(effectiveConcurrency, statuses.length) }, () => runWorker())
      await Promise.all(workers)
    }

    if (abortRef.current) return

    const videoUrls = statuses.filter(s => s.videoUrl).map(s => s.videoUrl!)
    const failedCount = statuses.filter(s => s.status === 'failed').length

    if (failedCount > 0) {
      showToast(`${failedCount} 个片段生成失败，将用已完成片段拼接`, 'info')
    }

    if (videoUrls.length === 0) {
      setErrorMessage('所有片段均生成失败，无法拼接')
      setPhase('error')
      return
    }

    // 拼接
    setPhase('concatenating')
    try {
      const url = await concatenateVideos(videoUrls, setConcatProgress)
      setFinalVideoUrl(url)
      // 把拼接结果保存到 IndexedDB，供跨 Quest 切换后恢复
      try {
        const resp = await fetch(url)
        const blob = await resp.blob()
        await saveVideoBlob(blob)
      } catch { /* 保存失败不影响当前使用 */ }
      setPhase('done')
      showToast('长视频生成完成！', 'success')
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '拼接失败')
      setPhase('error')
    }
  }, [apiKey, segments, resolution, concurrency, language, globalStyle, chainFrames, selectedProvider, enableNativeAudio, enableMultiShot, enableFirstLastFrameLock, lastFramePublicUrl, imgbbKey, protagonist, imagePool, showToast])

  const handleCancel = () => {
    abortRef.current = true
    setPhase('config')
  }

  // 重试拼接（片段已生成，仅重新执行拼接步骤）
  const handleRetryConcat = useCallback(async () => {
    const videoUrls = segments.filter(s => s.videoUrl).map(s => s.videoUrl!)
    if (videoUrls.length === 0) {
      showToast('没有可拼接的片段', 'error')
      return
    }
    setPhase('concatenating')
    setErrorMessage('')
    setConcatProgress(null)
    try {
      const url = await concatenateVideos(videoUrls, setConcatProgress)
      setFinalVideoUrl(url)
      // 保存到 IndexedDB
      try {
        const resp = await fetch(url)
        const blob = await resp.blob()
        await saveVideoBlob(blob)
      } catch { /* ignore */ }
      setPhase('done')
      showToast('长视频拼接完成！', 'success')
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '拼接失败')
      setPhase('error')
    }
  }, [segments, showToast])

  const completedCount = segments.filter(s => s.status === 'done').length
  const progressPercent = segments.length > 0 ? Math.round((completedCount / segments.length) * 100) : 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
      {/* Left: Config */}
      <div className="space-y-4">
        <Card className="border-border/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Film className="h-4 w-4 text-primary" />
              长视频生成
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 视频生成模型选择 - 切换后下面的能力开关会自动启用/灰掉 */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" />
                视频生成模型
              </label>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
                disabled={phase !== 'config'}
                className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-input text-sm text-foreground disabled:opacity-50"
              >
                {(Object.keys(PROVIDERS) as ProviderId[]).map(pid => (
                  <option key={pid} value={pid}>
                    {PROVIDERS[pid].displayName}{!PROVIDERS[pid].configured ? '（API 接入中）' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {providerMeta.description}。适合：{providerMeta.scenarios}
                {!providerMeta.needsApiKey && (
                  <span className="text-emerald-500"> · 通过 MuleRouter 聚合代理，无需额外 API Key（分镜拆解仍用 DashScope Qwen）</span>
                )}
                {!providerMeta.configured && (
                  <span className="text-amber-500"> · 此模型 API 待接入，可预览能力差异，暂不能实际生成</span>
                )}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">视频总描述</label>
              <textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); setShowRewrite(false) }}
                disabled={phase !== 'config'}
                placeholder="描述你想要的整体视频内容和故事线，系统会自动拆解为连续的分镜片段..."
                className="w-full h-28 px-3 py-2.5 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-all disabled:opacity-50"
              />
            </div>

            {/* AI 改写 */}
            {phase === 'config' && showRewrite && (
              <PromptRewriteSection
                apiKey={apiKey}
                prompt={prompt}
                context="long-video"
                imageDataUrls={rewriteImageDataUrls.length > 0 ? rewriteImageDataUrls : undefined}
                onConfirm={(rewritten) => {
                  setPrompt(rewritten)
                  setShowRewrite(false)
                }}
                onCancel={() => setShowRewrite(false)}
              />
            )}

            {/* 主角设定 - 确保分镜人物外形一致 */}
            {phase === 'config' && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <User className="h-3 w-3" />
                  主角设定（可选，设定后所有分镜自动使用此参考图保持人物一致）
                </label>
                {protagonist ? (
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="relative group">
                      <img src={protagonist.dataUrl} alt="主角" className="h-16 w-16 rounded-lg border border-primary/30 object-cover" />
                      <button
                        onClick={() => setProtagonist(null)}
                        className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{protagonist.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">所有分镜将以此图为参考生成视频（图生视频模式）</p>
                      {protagonist.publicUrl && (
                        <p className="text-[10px] text-emerald-500 mt-0.5 truncate" title={protagonist.publicUrl}>✅ 已上传 OSS</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <label className="flex items-center justify-center h-14 rounded-lg border border-dashed border-primary/40 bg-primary/5 transition-colors hover:bg-primary/10 cursor-pointer">
                    <span className="text-xs text-primary">上传主角照片（正脸清晰为佳）</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          try {
                            const blobUrl = await compressImage(file)
                            setProtagonist({ dataUrl: blobUrl, name: file.name })
                            // 同时上传到 OSS 获取公网 URL（供 MuleRouter 使用）
                            try {
                              const res = await uploadImage(file, imgbbKey)
                              setProtagonist(prev => prev ? { ...prev, publicUrl: res.url } : prev)
                              showToast('主角图已上传到图床', 'success')
                            } catch (err) {
                              console.warn('主角图 OSS 上传失败，MuleRouter 模式下将走 t2v:', err)
                            }
                          } catch {
                            showToast('图片处理失败', 'error')
                          }
                        }
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
              </div>
            )}

            {/* 图片池 - 配置阶段可上传图片供分镜使用 */}
            {phase === 'config' && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ImagePlus className="h-3 w-3" />
                  场景参考图（可选，拆分镜后可绑定到具体场景，优先级高于主角图）
                </label>
                {imagePool.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {imagePool.map(img => (
                      <div key={img.id} className="relative group">
                        <img src={img.dataUrl} alt={img.name} className="h-14 w-14 rounded border border-border/50 object-cover" />
                        <button
                          onClick={() => handleRemoveFromPool(img.id)}
                          className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex items-center justify-center h-12 rounded-lg border border-dashed border-border/80 bg-secondary/20 transition-colors hover:bg-secondary/40 cursor-pointer">
                  <span className="text-xs text-muted-foreground">点击上传图片（支持多选）</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) handleAddToPool(e.target.files)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">总时长</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={durationHours}
                  onChange={(e) => setDurationHours(Math.max(0, Math.min(10, Number(e.target.value))))}
                  disabled={phase !== 'config'}
                  className="w-14 px-2 py-2 rounded-lg bg-secondary/50 border border-input text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                <span className="text-xs text-muted-foreground">时</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Math.max(0, Math.min(59, Number(e.target.value))))}
                  disabled={phase !== 'config'}
                  className="w-14 px-2 py-2 rounded-lg bg-secondary/50 border border-input text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                <span className="text-xs text-muted-foreground">分</span>
                <input
                  type="number"
                  min={0}
                  max={55}
                  step={5}
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(Math.max(0, Math.min(55, Math.round(Number(e.target.value) / 5) * 5)))}
                  disabled={phase !== 'config'}
                  className="w-14 px-2 py-2 rounded-lg bg-secondary/50 border border-input text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                <span className="text-xs text-muted-foreground">秒</span>
              </div>
              <p className="text-[10px] text-muted-foreground">最低10秒，秒数按5递增</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">片段时长</label>
                <select
                  value={segmentDuration}
                  onChange={(e) => setSegmentDuration(Number(e.target.value))}
                  disabled={phase !== 'config'}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-input text-sm text-foreground disabled:opacity-50"
                >
                  {caps.durationsPerSegment.map(d => (
                    <option key={d} value={d}>{d}秒</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">分辨率</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as '480p' | '720p' | '1080p')}
                  disabled={phase !== 'config'}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-input text-sm text-foreground disabled:opacity-50"
                >
                  {caps.resolutions.map(r => (
                    <option key={r} value={r}>{r.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">并发数</label>
                <select
                  value={chainFrames ? 1 : concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  disabled={phase !== 'config' || chainFrames}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-input text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                </select>
                {chainFrames && (
                  <p className="text-[10px] text-muted-foreground">链式衔接时上段尾帧作下段首帧，必须串行执行，故并发锁定为 1</p>
                )}
              </div>
            </div>

            {/* 模型高级能力开关：根据 capabilities 自动启用/灰掉 */}
            <div className="space-y-2 p-2.5 rounded-lg border border-border/50 bg-secondary/20">
              <p className="text-[10px] text-muted-foreground font-medium">模型能力（根据所选模型自动启用/灰掉）</p>
              <div className="grid grid-cols-2 gap-2">
                {/* 原生音效（Kling/Muledance 支持） */}
                <label
                  className={`flex items-center gap-2 text-xs cursor-pointer ${!caps.nativeAudio ? 'opacity-40 cursor-not-allowed' : ''}`}
                  title={caps.nativeAudio ? '由模型直接生成与画面同步的音效/对白' : '当前模型不支持原生音效'}
                >
                  <input
                    type="checkbox"
                    checked={enableNativeAudio}
                    onChange={(e) => setEnableNativeAudio(e.target.checked)}
                    disabled={!caps.nativeAudio || phase !== 'config'}
                    className="rounded"
                  />
                  <span>原生音效{!caps.nativeAudio && ' · 不支持'}</span>
                </label>
                {/* 多镜头单次生成（Kling 独有） */}
                <label
                  className={`flex items-center gap-2 text-xs cursor-pointer ${!caps.multiShot ? 'opacity-40 cursor-not-allowed' : ''}`}
                  title={caps.multiShot ? '单次生成可包含多镜头切换' : '当前模型不支持多镜头模式'}
                >
                  <input
                    type="checkbox"
                    checked={enableMultiShot}
                    onChange={(e) => setEnableMultiShot(e.target.checked)}
                    disabled={!caps.multiShot || phase !== 'config'}
                    className="rounded"
                  />
                  <span>多镜头模式{!caps.multiShot && ' · 不支持'}</span>
                </label>
                {/* 首尾帧硬锁定（Muledance/Seedance 独有，需公网尾帧图 URL） */}
                <label
                  className={`flex items-center gap-2 text-xs cursor-pointer ${!caps.firstLastFrameLock ? 'opacity-40 cursor-not-allowed' : ''}`}
                  title={
                    !caps.firstLastFrameLock
                      ? '当前模型不支持首尾帧硬锁'
                      : '锁定第一段首帧与最后一段尾帧，生成无缝循环或固定收尾画面（Muledance 需公网图片 URL）'
                  }
                >
                  <input
                    type="checkbox"
                    checked={enableFirstLastFrameLock}
                    onChange={(e) => setEnableFirstLastFrameLock(e.target.checked)}
                    disabled={!caps.firstLastFrameLock || phase !== 'config'}
                    className="rounded"
                  />
                  <span>首尾帧硬锁{!caps.firstLastFrameLock ? ' · 不支持' : ''}</span>
                </label>

                {/* 首尾帧硬锁：尾帧图上传/输入 */}
                {caps.firstLastFrameLock && enableFirstLastFrameLock && (
                  <div className="ml-5 space-y-2 rounded-md bg-secondary/30 p-2.5">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Upload className="h-3 w-3" />
                        尾帧图（公网 URL）
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={lastFramePublicUrl}
                          onChange={(e) => setLastFramePublicUrl(e.target.value)}
                          disabled={phase !== 'config'}
                          placeholder="https://... 或直接上传本地图片"
                          className="flex-1 min-w-0 px-2 py-1.5 rounded bg-background border border-input text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <label className="shrink-0 cursor-pointer">
                          <input
                            type="file"
                            accept="image/*"
                            disabled={phase !== 'config' || uploadingLastFrame}
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) return
                              setUploadingLastFrame(true)
                              try {
                                const res = await uploadImage(file, imgbbKey)
                                setLastFramePublicUrl(res.url)
                                showToast('尾帧图已上传', 'success')
                              } catch (err) {
                                showToast(err instanceof Error ? err.message : '上传失败', 'error')
                              } finally {
                                setUploadingLastFrame(false)
                              }
                            }}
                            className="hidden"
                          />
                          <span className={`inline-flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium border ${uploadingLastFrame ? 'bg-muted text-muted-foreground border-input cursor-not-allowed' : 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'}`}>
                            {uploadingLastFrame ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                上传中
                              </>
                            ) : (
                              <>
                                <Upload className="h-3 w-3" />
                                上传
                              </>
                            )}
                          </span>
                        </label>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        优先通过本地 dev server 上传到阿里云 OSS；若 OSS 未配置则回退 ImgBB（需配置 API Key）。
                      </p>
                      {lastFramePublicUrl && !isPublicHttpUrl(lastFramePublicUrl) && (
                        <p className="text-[10px] text-destructive">必须是公网 HTTP(S) URL，localhost 无效</p>
                      )}
                    </div>
                  </div>
                )}

                {/* 多参考图（MuleRouter 通过 OSS 中转后也可用） */}
                <div
                  className="flex items-center gap-2 text-xs"
                  title={`当前模型每段最多支持 ${caps.multiRefImagesMax} 张参考图`}
                >
                  <span className="text-muted-foreground">多参考图：</span>
                  <span className={caps.multiRefImagesMax > 1 ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}>
                    最多 {caps.multiRefImagesMax} 张
                  </span>
                </div>
              </div>
              {(caps.refVideosMax > 0 || caps.refAudiosMax > 0 || caps.multiLanguageNative) && (
                <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                  额外支持：
                  {caps.refVideosMax > 0 && `参考视频 ×${caps.refVideosMax} `}
                  {caps.refAudiosMax > 0 && `参考音频 ×${caps.refAudiosMax} `}
                  {caps.multiLanguageNative && '原生多语言'}
                </p>
              )}
            </div>

            {/* 链式衔接开关：上段尾帧作下段首帧，避免“段头回放”感 */}
            <div className="flex items-start gap-3 rounded-lg bg-secondary/30 px-3 py-2.5">
              <input
                id="chain-frames"
                type="checkbox"
                checked={chainFrames}
                onChange={(e) => setChainFrames(e.target.checked)}
                disabled={phase !== 'config' || selectedProvider !== 'happyhorse'}
                className="mt-0.5 h-4 w-4 accent-primary disabled:opacity-50"
              />
              <label htmlFor="chain-frames" className={`flex-1 space-y-0.5 ${selectedProvider !== 'happyhorse' ? 'opacity-50' : 'cursor-pointer'}`}>
                <span className="block text-xs font-medium text-foreground">段间画面连续（链式衔接）</span>
                <span className="block text-[10px] text-muted-foreground leading-relaxed">
                  {selectedProvider !== 'happyhorse'
                    ? `当前模型（${providerMeta.shortName}）不支持：链式衔接需将尾帧作首帧图传入，但 MuleRouter 不接受本地图片。`
                    : '上段尾帧作下段首帧，画面从上段姿态连续演变，避免"段头回放"感。启用后必须串行执行（并发=1），总耗时会变长。'
                  }
                </span>
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">语言偏好</label>
              <div className="flex gap-2">
                {[
                  { value: 'zh', label: '普通话' },
                  { value: 'en', label: 'English' },
                  { value: 'yue', label: '广东话' },
                ].map((l) => (
                  <button
                    key={l.value}
                    onClick={() => setLanguage(l.value as 'zh' | 'en' | 'yue')}
                    disabled={phase !== 'config'}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-50 ${
                      language === l.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary/50 text-foreground hover:bg-secondary/80 border border-input'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">影响画面文字风格与文化场景氛围</p>
            </div>

            <div className="rounded-lg bg-secondary/30 p-3 space-y-1">
              <p className="text-xs text-muted-foreground">预计生成: <span className="text-foreground font-medium">{segmentCount}</span> 个片段</p>
              <p className="text-xs text-muted-foreground">预计费用: <span className="text-foreground font-medium">
                {resolution === '720p' ? (totalSeconds * 0.9).toFixed(1) : (totalSeconds * 1.6).toFixed(1)} 元
              </span>（720P ¥0.9/秒，1080P ¥1.6/秒）</p>
            </div>

            {phase === 'config' && !showRewrite && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 border-primary/30 text-primary hover:bg-primary/5"
                  onClick={async () => {
                    // 有图片时，先转为 base64 供视觉模型分析
                    if (imagePool.length > 0) {
                      try {
                        const urls = await Promise.all(imagePool.map(img => blobUrlToBase64(img.dataUrl)))
                        setRewriteImageDataUrls(urls)
                      } catch {
                        setRewriteImageDataUrls([])
                      }
                    } else {
                      setRewriteImageDataUrls([])
                    }
                    setShowRewrite(true)
                  }}
                  disabled={!prompt.trim()}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {imagePool.length > 0 ? `AI 改写（结合 ${imagePool.length} 张图片分析）` : 'AI 改写总描述（优化叙事/风格）'}
                </Button>
                <Button variant="gradient" className="w-full h-11" onClick={() => handleDecompose()} disabled={!prompt.trim()}>
                  <Wand2 className="h-4 w-4 mr-2" />
                  开始拆解分镜（{segmentCount}段）
                </Button>
              </div>
            )}

            {phase === 'decomposing' && (
              <Button variant="outline" className="w-full" disabled>
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI 正在拆解分镜...
                </span>
              </Button>
            )}

            {phase === 'review-scenes' && (
              <div className="space-y-2">
                <Button variant="gradient" className="w-full h-11" onClick={handleConfirmAndGenerate}>
                  <Check className="h-4 w-4 mr-2" />
                  确认分镜，开始生成
                </Button>
                <Button variant="outline" className="w-full" onClick={() => { setPhase('config'); setSegments([]) }}>
                  返回修改
                </Button>
              </div>
            )}

            {(phase === 'generating' || phase === 'concatenating') && (
              <Button variant="outline" className="w-full" onClick={handleCancel}>
                取消
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: Scene Review & Progress */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">
            {phase === 'review-scenes' ? '分镜预览（点击可编辑）' : '生成进度'}
          </span>
          <span className="text-xs text-muted-foreground">
            {phase === 'decomposing' && '正在AI拆解分镜...'}
            {phase === 'review-scenes' && `${segments.length} 个分镜待确认`}
            {phase === 'generating' && `生成中 ${completedCount}/${segments.length}`}
            {phase === 'concatenating' && '正在拼接视频...'}
            {phase === 'done' && '完成'}
            {phase === 'error' && '出错'}
          </span>
        </div>

        {/* 全局风格锚：review 阶段可编辑，提交时会 prefix 到每个分镜 prompt */}
        {globalStyle && (phase === 'review-scenes' || phase === 'generating' || phase === 'concatenating' || phase === 'done') && (
          <div className="px-4 py-3 border-b border-border/50 bg-primary/5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="text-[11px] font-medium text-primary">全局风格锚（自动拼接到每个分镜，保证画风/人物/色调一致）</span>
            </div>
            {phase === 'review-scenes' ? (
              <textarea
                value={globalStyle}
                onChange={(e) => setGlobalStyle(e.target.value)}
                className="w-full h-16 px-2 py-1.5 rounded bg-background border border-input text-[11px] text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring leading-relaxed"
              />
            ) : (
              <p className="text-[11px] text-foreground/80 leading-relaxed">{globalStyle}</p>
            )}
          </div>
        )}

        {/* 背景一致性快捷操作：Review 阶段可一键把某张图同步到所有分镜 */}
        {phase === 'review-scenes' && segments.length > 1 && (() => {
          const firstWithImage = segments.find(s => s.imageUrl)
          const sourceImg = protagonist?.dataUrl || firstWithImage?.imageUrl || imagePool[0]?.dataUrl
          if (!sourceImg) return null
          const unboundCount = segments.filter(s => !s.imageUrl).length
          return (
            <div className="px-4 py-2.5 border-b border-border/50 bg-amber-500/5 flex items-center gap-3">
              <img src={sourceImg} alt="参考图" className="h-10 w-10 rounded border border-amber-500/30 object-cover shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-foreground font-medium">背景跳跃太大？一键让所有分镜共享同一张参考图</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">全片走 i2v 可最大程度保证背景/场景一致</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {unboundCount > 0 && (
                  <button
                    onClick={() => handleApplyImageToAll(sourceImg)}
                    className="px-2 py-1 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 border border-amber-500/30 transition-colors"
                    title={`同步到 ${unboundCount} 个未绑图的分镜`}
                  >
                    填充未绑图 ({unboundCount})
                  </button>
                )}
                <button
                  onClick={() => handleForceApplyImageToAll(sourceImg)}
                  className="px-2 py-1 rounded text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 transition-colors"
                  title="强制覆盖所有分镜"
                >
                  全部同步
                </button>
              </div>
            </div>
          )
        })()}

        {/* Progress bar */}
        {(phase === 'generating' || phase === 'concatenating' || phase === 'done') && (
          <div className="px-4 py-3 border-b border-border/50 space-y-2">
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full gradient-primary transition-all duration-700 rounded-full"
                style={{
                  width: phase === 'concatenating' ? `${50 + (concatProgress?.percent || 0) / 2}%`
                    : phase === 'done' ? '100%'
                    : `${progressPercent * 0.9}%`
                }}
              />
            </div>
            {concatProgress && phase === 'concatenating' && (
              <p className="text-xs text-muted-foreground">{concatProgress.message}</p>
            )}
          </div>
        )}

        {/* Scene list (review mode - editable) */}
        {segments.length > 0 && (
          <div className="flex-1 min-h-0 max-h-[400px] overflow-y-auto divide-y divide-border/30">
            {segments.map((seg, i) => (
              <div key={i} className={`px-4 py-3 hover:bg-secondary/20 transition-colors ${phase === 'review-scenes' ? 'cursor-pointer' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="text-xs text-muted-foreground font-mono w-6 text-right mt-0.5">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    {editingSceneIdx === i && phase === 'review-scenes' ? (
                      <div className="space-y-2">
                        <textarea
                          value={seg.segment.prompt}
                          onChange={(e) => handleSceneEdit(i, e.target.value)}
                          className="w-full h-20 px-2 py-1.5 rounded bg-background border border-input text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                          autoFocus
                        />
                        <button
                          onClick={() => setEditingSceneIdx(null)}
                          className="text-[10px] text-primary hover:underline"
                        >
                          完成编辑
                        </button>
                      </div>
                    ) : (
                      <p
                        className="text-xs text-foreground leading-relaxed"
                        onClick={() => { if (phase === 'review-scenes') setEditingSceneIdx(i) }}
                      >
                        {seg.segment.prompt}
                        {phase === 'review-scenes' && (
                          <Pencil className="inline h-2.5 w-2.5 ml-1.5 text-muted-foreground" />
                        )}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{seg.segment.durationSec}秒</span>
                      {/* 路由模式徽章：review 阶段可点击切换 i2v/t2v */}
                      {(() => {
                        // 计算实际运行时的 route（考虑首尾帧硬锁覆盖）
                        const lockActive = enableFirstLastFrameLock && isPublicHttpUrl(lastFramePublicUrl) && selectedProvider === 'muledance-2.0'
                        const isFirst = i === 0
                        const isLast = i === segments.length - 1
                        const effectiveRoute = seg.routeMode === 'i2v' ? 'i2v'
                          : (lockActive && (isFirst || isLast)) ? 'i2v' : 't2v'
                        const lockHint = lockActive && isFirst && seg.routeMode === 't2v' ? '（首帧硬锁→i2v）'
                          : lockActive && isLast && !isFirst && seg.routeMode === 't2v' ? '（尾帧硬锁→i2v）' : ''
                        const lastHint = lockActive && isLast ? ' +尾帧锁' : ''
                        return effectiveRoute === 'i2v' ? (
                          <button
                            type="button"
                            disabled={phase !== 'review-scenes' || !seg.imageUrl}
                            onClick={(e) => { e.stopPropagation(); handleToggleRouteMode(i) }}
                            title={phase === 'review-scenes' ? `点击切换为文生视频。${seg.routeReason || ''}${lockHint}` : seg.routeReason}
                            className="text-[10px] font-medium text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded hover:bg-blue-500/20 disabled:cursor-default disabled:hover:bg-blue-500/10"
                          >
                            图生视频 i2v{lockHint}{lastHint}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={phase !== 'review-scenes' || !seg.imageUrl}
                            onClick={(e) => { e.stopPropagation(); handleToggleRouteMode(i) }}
                            title={
                              phase === 'review-scenes' && seg.imageUrl
                                ? `点击切换为图生视频。当前走 t2v 原因：${seg.routeReason || '未说明'}`
                                : seg.routeReason
                            }
                            className="text-[10px] font-medium text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded hover:bg-amber-500/20 disabled:cursor-default disabled:hover:bg-amber-500/10"
                          >
                            文生视频 t2v{lastHint}
                          </button>
                        )
                      })()}
                      {protagonist && (
                        <span className="text-[10px] font-medium text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded">主角参考</span>
                      )}
                      {/* 对白字幕徽章（中文 dialogue，由 ffmpeg 烧录到视频底部居中） */}
                      {seg.segment.dialogue && seg.segment.dialogue.trim().length > 0 && (
                        <span
                          className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded"
                          title={`字幕：${seg.segment.dialogue}`}
                        >
                          字幕：{seg.segment.dialogue}
                        </span>
                      )}
                    </div>
                    {/* 失败错误信息（直接展示，方便定位） */}
                    {seg.status === 'failed' && seg.error && (
                      <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/30 space-y-1">
                        <p className="text-[10px] text-destructive break-all leading-relaxed font-mono">{seg.error}</p>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            try {
                              await navigator.clipboard.writeText(seg.error || '')
                              showToast('错误信息已复制', 'success')
                            } catch {
                              showToast('复制失败，请手动选中文本', 'error')
                            }
                          }}
                          className="text-[10px] text-destructive/80 underline hover:text-destructive"
                        >
                          复制错误信息
                        </button>
                      </div>
                    )}
                    {/* 图片预览 + 绑定/解绑（MuleRouter 模型下灰掉，不支持本地图片） */}
                    {phase === 'review-scenes' && selectedProvider === 'happyhorse' && (
                      <div className="mt-2">
                        {seg.imageUrl ? (
                          <div className="relative inline-block">
                            <img src={seg.imageUrl} alt={`分镜${i + 1}参考图`} className="h-16 rounded border border-border/50 object-cover" />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleUnbindImage(i) }}
                              className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:bg-destructive/80"
                              title="移除图片"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* 从图片池选择 */}
                            {imagePool.length > 0 && imagePool.map(img => (
                              <button
                                key={img.id}
                                onClick={(e) => { e.stopPropagation(); handleBindImageFromPool(i, img.dataUrl) }}
                                className="h-10 w-10 rounded border border-dashed border-primary/40 hover:border-primary overflow-hidden transition-colors"
                                title={`使用: ${img.name}`}
                              >
                                <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                              </button>
                            ))}
                            {/* 或直接上传新图 */}
                            <label className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 cursor-pointer h-10 px-2 rounded border border-dashed border-border/80 hover:border-primary/40 transition-colors">
                              <ImagePlus className="h-3 w-3" />
                              <span>{imagePool.length > 0 ? '上传新图' : '绑定图片'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) handleBindImage(i, file)
                                  e.target.value = ''
                                }}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                    {phase === 'review-scenes' && selectedProvider !== 'happyhorse' && (
                      <p className="mt-1 text-[10px] text-amber-500/70">当前模型不支持本地参考图</p>
                    )}
                  </div>
                  {phase !== 'review-scenes' && phase !== 'config' && (
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded shrink-0 ${
                      seg.status === 'done' ? 'text-green-500 bg-green-500/10'
                      : seg.status === 'running' || seg.status === 'submitted' ? 'text-primary bg-primary/10'
                      : seg.status === 'failed' ? 'text-destructive bg-destructive/10'
                      : 'text-muted-foreground bg-secondary'
                    }`}>
                      {seg.status === 'done' ? '完成' : seg.status === 'running' ? '生成中' : seg.status === 'submitted' ? '提交中' : seg.status === 'failed' ? '失败' : '排队'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Final video or placeholder */}
        <div className="border-t border-border/50 p-4">
          {phase === 'done' && finalVideoUrl ? (
            <div className="space-y-3">
              <video src={finalVideoUrl} controls className="w-full rounded-lg aspect-video bg-background" />
              <a href={finalVideoUrl} download={`long-video-${Date.now()}.mp4`}>
                <Button variant="outline" size="sm" className="w-full">
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  下载完整视频
                </Button>
              </a>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => {
                  setPhase('config')
                  setSegments([])
                  setGlobalStyle('')
                  setFinalVideoUrl(null)
                  clearVideoBlob() // 清除 IndexedDB 中的视频
                  localStorage.removeItem(STORAGE_KEY) // 清除持久化状态
                  setConcatProgress(null)
                  setErrorMessage('')
                  setPrompt('')
                  setShowRewrite(false)
                  setRewriteImageDataUrls([])
                }}
              >
                <Film className="h-3.5 w-3.5" />
                新建长视频
              </Button>
            </div>
          ) : phase === 'error' ? (
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-destructive">{errorMessage}</p>
              {segments.some(s => s.videoUrl) && (
                <Button variant="gradient" size="sm" className="w-full" onClick={handleRetryConcat}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  重试拼接（已有 {segments.filter(s => s.videoUrl).length} 个片段）
                </Button>
              )}
              <Button variant="outline" size="sm" className="w-full" onClick={() => setPhase('config')}>
                返回重新配置
              </Button>
            </div>
          ) : phase === 'generating' || phase === 'concatenating' ? (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
              <span className="text-sm text-muted-foreground">
                {phase === 'concatenating' ? '拼接中...' : '片段生成中，请耐心等待...'}
              </span>
            </div>
          ) : phase === 'review-scenes' ? (
            <div className="flex flex-col items-center py-4 gap-2 text-center">
              <Pencil className="h-6 w-6 text-primary" />
              <p className="text-xs text-muted-foreground">请检查上方分镜prompt，可点击编辑修改。确认无误后点击左侧「确认分镜，开始生成」</p>
            </div>
          ) : phase === 'decomposing' ? (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
              <span className="text-sm text-muted-foreground">AI正在构思分镜剧本...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <Play className="h-8 w-8 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">配置参数后点击开始，流程：改写prompt → 拆分镜 → review → 生成 → 拼接</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
