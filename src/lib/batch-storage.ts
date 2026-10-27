import { BatchQueueState, BatchLogEntry, DEFAULT_BATCH_SETTINGS } from './batch-types'

const QUEUE_STATE_KEY = 'batch_queue_state'
const LOG_KEY = 'batch_log_entries'
const MAX_LOG_ENTRIES = 500

/** 保存队列状态 */
export function saveQueueState(state: BatchQueueState): void {
  try {
    const data = JSON.stringify(state)
    localStorage.setItem(QUEUE_STATE_KEY, data)
  } catch {
    // localStorage可能满了，清除错误历史后再试
    const trimmed = {
      ...state,
      tasks: state.tasks.map(t => ({
        ...t,
        errorHistory: t.errorHistory.slice(-3),
      })),
    }
    try {
      localStorage.setItem(QUEUE_STATE_KEY, JSON.stringify(trimmed))
    } catch {
      // 放弃持久化
    }
  }
}

/** 加载队列状态 */
export function loadQueueState(): BatchQueueState | null {
  try {
    const data = localStorage.getItem(QUEUE_STATE_KEY)
    if (!data) return null
    const state = JSON.parse(data) as BatchQueueState
    // 验证基本结构
    if (!state.tasks || !Array.isArray(state.tasks)) return null
    return state
  } catch {
    return null
  }
}

/** 清除队列状态 */
export function clearQueueState(): void {
  localStorage.removeItem(QUEUE_STATE_KEY)
  localStorage.removeItem(LOG_KEY)
}

/** 保存日志 */
export function saveLogs(entries: BatchLogEntry[]): void {
  try {
    const trimmed = entries.slice(-MAX_LOG_ENTRIES)
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed))
  } catch {
    // 忽略
  }
}

/** 加载日志 */
export function loadLogs(): BatchLogEntry[] {
  try {
    const data = localStorage.getItem(LOG_KEY)
    if (!data) return []
    return JSON.parse(data) as BatchLogEntry[]
  } catch {
    return []
  }
}

/** 获取默认初始状态 */
export function getInitialQueueState(): BatchQueueState {
  return {
    tasks: [],
    status: 'idle',
    settings: { ...DEFAULT_BATCH_SETTINGS },
  }
}

/** 注册页面离开警告 */
export function registerBeforeUnload(isRunning: () => boolean): () => void {
  const handler = (e: BeforeUnloadEvent) => {
    if (isRunning()) {
      e.preventDefault()
    }
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}
