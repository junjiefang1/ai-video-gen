import { VideoMode } from './api'

/** 应用导航模式(含批量和长视频) */
export type AppMode = VideoMode | 'batch' | 'long-video'

/** 批量任务输入来源类型 */
export type BatchSourceType = 'multi-prompt' | 'file-upload' | 'template-combo'

/** 单个批量任务的定义(待执行参数) */
export interface BatchTaskDefinition {
  id: string
  mode: VideoMode
  prompt: string
  resolution: '480p' | '720p' | '1080p'
  duration: number
  imageUrl?: string
  videoUrl?: string
  refImageUrl?: string
}

/** 批量任务运行时状态 */
export type BatchTaskStatus =
  | 'queued'
  | 'submitting'
  | 'polling'
  | 'retrying'
  | 'succeeded'
  | 'failed-permanent'
  | 'cancelled'

/** 单条任务的完整运行时数据 */
export interface BatchTaskItem {
  id: string
  definition: BatchTaskDefinition
  status: BatchTaskStatus
  remoteTaskId?: string
  videoUrl?: string
  retryCount: number
  downgradeLevel: number
  promptSimplified: boolean
  errorHistory: ErrorRecord[]
  startedAt?: number
  completedAt?: number
}

/** 错误记录 */
export interface ErrorRecord {
  time: number
  message: string
}

/** 批量队列全局状态 */
export type QueueStatus = 'idle' | 'running' | 'paused' | 'completed'

export interface BatchQueueState {
  tasks: BatchTaskItem[]
  status: QueueStatus
  settings: BatchSettings
}

/** 批量执行设置 */
export interface BatchSettings {
  concurrency: number         // 1-5
  maxRetries: number          // default 3
  autoDowngrade: boolean      // default true
  autoPromptSimplify: boolean // default true
}

/** 日志条目 */
export interface BatchLogEntry {
  timestamp: number
  taskId: string
  taskIndex: number
  event: string
  level: 'info' | 'warn' | 'error' | 'success'
}

/** 模板组合配置 */
export interface TemplateCombination {
  promptTemplate: string
  mode: VideoMode
  resolutions: ('480p' | '720p' | '1080p')[]
  durations: number[]
}

/** 文件解析结果 */
export interface ParseResult {
  valid: BatchTaskDefinition[]
  errors: ParseError[]
}

/** 解析错误 */
export interface ParseError {
  row: number
  message: string
}

/** 导出结果项 */
export interface ExportResultItem {
  index: number
  prompt: string
  mode: VideoMode
  resolution: string
  duration: number
  status: BatchTaskStatus
  videoUrl?: string
  error?: string
  retryCount: number
}

/** 默认设置 */
export const DEFAULT_BATCH_SETTINGS: BatchSettings = {
  concurrency: 2,
  maxRetries: 3,
  autoDowngrade: true,
  autoPromptSimplify: true,
}

/** 生成唯一ID */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
