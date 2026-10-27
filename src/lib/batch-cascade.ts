import { BatchTaskItem, BatchSettings } from './batch-types'

type Resolution = '480p' | '720p' | '1080p'

const RESOLUTION_ORDER: Resolution[] = ['1080p', '720p', '480p']
const DURATION_ORDER = [10, 7, 5, 3, 2]

export interface CascadeDecision {
  action: 'retry' | 'downgrade' | 'simplify-prompt' | 'fail-permanent'
  delayMs?: number
  newResolution?: Resolution
  newDuration?: number
  newPrompt?: string
}

/**
 * 根据当前任务状态和设置，决定下一步容错动作
 */
export function decideCascadeAction(
  task: BatchTaskItem,
  settings: BatchSettings,
  _errorMessage: string
): CascadeDecision {
  // Step 1: 重试原参数(指数退避)
  if (task.retryCount < settings.maxRetries) {
    const delayMs = Math.pow(2, task.retryCount + 1) * 1000 // 2s, 4s, 8s
    return { action: 'retry', delayMs }
  }

  // Step 2: 参数降级
  if (settings.autoDowngrade) {
    const downgradeResult = getDowngradedParams(
      task.definition.resolution,
      task.definition.duration,
      task.downgradeLevel
    )
    if (downgradeResult) {
      return {
        action: 'downgrade',
        newResolution: downgradeResult.resolution,
        newDuration: downgradeResult.duration,
      }
    }
  }

  // Step 3: Prompt简化
  if (settings.autoPromptSimplify && !task.promptSimplified) {
    const simplified = simplifyPrompt(task.definition.prompt)
    if (simplified !== task.definition.prompt) {
      return { action: 'simplify-prompt', newPrompt: simplified }
    }
  }

  // Step 4: 永久失败
  return { action: 'fail-permanent' }
}

/**
 * 获取降级后的参数
 */
function getDowngradedParams(
  currentResolution: Resolution,
  currentDuration: number,
  downgradeLevel: number
): { resolution: Resolution; duration: number } | null {
  const resIdx = RESOLUTION_ORDER.indexOf(currentResolution)
  const durIdx = DURATION_ORDER.indexOf(currentDuration)

  // 根据已降级次数决定策略
  if (downgradeLevel === 0 && resIdx < RESOLUTION_ORDER.length - 1) {
    // 第一次：降低分辨率
    return { resolution: RESOLUTION_ORDER[resIdx + 1], duration: currentDuration }
  }
  if (downgradeLevel === 1 && resIdx < RESOLUTION_ORDER.length - 1) {
    // 第二次：继续降分辨率
    return { resolution: RESOLUTION_ORDER[Math.min(resIdx + 2, RESOLUTION_ORDER.length - 1)], duration: currentDuration }
  }
  if (downgradeLevel <= 2 && durIdx >= 0 && durIdx < DURATION_ORDER.length - 1) {
    // 降低时长
    return { resolution: RESOLUTION_ORDER[RESOLUTION_ORDER.length - 1], duration: DURATION_ORDER[durIdx + 1] }
  }

  // 无法继续降级
  return null
}

/**
 * 简化Prompt：去除特殊字符，截断长度
 */
export function simplifyPrompt(prompt: string): string {
  // 去除特殊符号
  let simplified = prompt.replace(/[!@#$%^&*()_+=\[\]{};':"\\|<>?~`，。！？、；：""''【】《》（）]/g, ' ')
  // 合并多余空格
  simplified = simplified.replace(/\s+/g, ' ').trim()
  // 截断到100字符
  if (simplified.length > 100) {
    simplified = simplified.slice(0, 100)
  }
  return simplified
}
