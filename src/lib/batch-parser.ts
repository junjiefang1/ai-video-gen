import { BatchTaskDefinition, ParseResult, ParseError, TemplateCombination, generateId } from './batch-types'
import { VideoMode } from './api'

type Resolution = '480p' | '720p' | '1080p'

/**
 * 解析多行Prompt文本为任务列表
 */
export function parseMultiPrompt(
  text: string,
  defaultMode: VideoMode,
  defaultResolution: Resolution,
  defaultDuration: number
): BatchTaskDefinition[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(prompt => ({
      id: generateId(),
      mode: defaultMode,
      prompt,
      resolution: defaultResolution,
      duration: defaultDuration,
    }))
}

/**
 * 解析上传文件(CSV或JSON)
 */
export function parseUploadedFile(content: string, fileName: string): ParseResult {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'json') {
    return parseJson(content)
  }
  return parseCsv(content)
}

function parseJson(content: string): ParseResult {
  const valid: BatchTaskDefinition[] = []
  const errors: ParseError[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { valid: [], errors: [{ row: 0, message: 'JSON格式无效' }] }
  }

  if (!Array.isArray(parsed)) {
    return { valid: [], errors: [{ row: 0, message: 'JSON应为数组格式' }] }
  }

  parsed.forEach((item: unknown, index: number) => {
    const row = index + 1
    if (!item || typeof item !== 'object') {
      errors.push({ row, message: '无效的任务对象' })
      return
    }
    const obj = item as Record<string, unknown>
    const result = validateTaskRow(obj, row)
    if (result.error) {
      errors.push(result.error)
    } else if (result.task) {
      valid.push(result.task)
    }
  })

  return { valid, errors }
}

function parseCsv(content: string): ParseResult {
  const valid: BatchTaskDefinition[] = []
  const errors: ParseError[] = []
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  if (lines.length < 2) {
    return { valid: [], errors: [{ row: 0, message: 'CSV至少需要表头和一行数据' }] }
  }

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim())
  const promptIdx = headers.indexOf('prompt')
  const modeIdx = headers.indexOf('mode')
  const resIdx = headers.indexOf('resolution')
  const durIdx = headers.indexOf('duration')
  const imgIdx = headers.indexOf('imageurl')
  const vidIdx = headers.indexOf('videourl')
  const refIdx = headers.indexOf('refimageurl')

  if (promptIdx === -1) {
    return { valid: [], errors: [{ row: 1, message: '缺少必需的prompt列' }] }
  }

  for (let i = 1; i < lines.length; i++) {
    const row = i + 1
    const cols = parseCsvLine(lines[i])
    const prompt = cols[promptIdx]?.trim()
    if (!prompt) {
      errors.push({ row, message: 'prompt为空' })
      continue
    }

    const mode = (modeIdx >= 0 ? cols[modeIdx]?.trim() : 'text-to-video') as VideoMode
    const resolution = (resIdx >= 0 ? cols[resIdx]?.trim() : '720p') as Resolution
    const duration = durIdx >= 0 ? parseInt(cols[durIdx]?.trim() || '5') : 5

    if (!['text-to-video', 'image-to-video', 'video-edit'].includes(mode)) {
      errors.push({ row, message: `无效的mode: ${mode}` })
      continue
    }

    valid.push({
      id: generateId(),
      mode,
      prompt,
      resolution,
      duration: isNaN(duration) ? 5 : duration,
      imageUrl: imgIdx >= 0 ? cols[imgIdx]?.trim() || undefined : undefined,
      videoUrl: vidIdx >= 0 ? cols[vidIdx]?.trim() || undefined : undefined,
      refImageUrl: refIdx >= 0 ? cols[refIdx]?.trim() || undefined : undefined,
    })
  }

  return { valid, errors }
}

/** 简单CSV行解析(支持引号包裹) */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

function validateTaskRow(
  obj: Record<string, unknown>,
  row: number
): { task?: BatchTaskDefinition; error?: ParseError } {
  const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : ''
  if (!prompt) {
    return { error: { row, message: 'prompt为空' } }
  }

  const mode = (typeof obj.mode === 'string' ? obj.mode : 'text-to-video') as VideoMode
  if (!['text-to-video', 'image-to-video', 'video-edit'].includes(mode)) {
    return { error: { row, message: `无效的mode: ${mode}` } }
  }

  const resolution = (typeof obj.resolution === 'string' ? obj.resolution : '720p') as Resolution
  const duration = typeof obj.duration === 'number' ? obj.duration : 5

  return {
    task: {
      id: generateId(),
      mode,
      prompt,
      resolution,
      duration,
      imageUrl: typeof obj.imageUrl === 'string' ? obj.imageUrl : undefined,
      videoUrl: typeof obj.videoUrl === 'string' ? obj.videoUrl : undefined,
      refImageUrl: typeof obj.refImageUrl === 'string' ? obj.refImageUrl : undefined,
    }
  }
}

/**
 * 展开模板组合为任务列表
 */
export function expandTemplate(config: TemplateCombination): BatchTaskDefinition[] {
  const tasks: BatchTaskDefinition[] = []

  for (const resolution of config.resolutions) {
    for (const duration of config.durations) {
      const prompt = config.promptTemplate
        .replace(/\{\{resolution\}\}/g, resolution)
        .replace(/\{\{duration\}\}/g, String(duration))

      tasks.push({
        id: generateId(),
        mode: config.mode,
        prompt,
        resolution,
        duration,
      })
    }
  }

  return tasks
}
