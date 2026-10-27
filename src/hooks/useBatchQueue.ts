import { useReducer, useCallback, useEffect, useRef } from 'react'
import {
  BatchQueueState,
  BatchTaskItem,
  BatchTaskDefinition,
  BatchSettings,
  QueueStatus,
} from '@/lib/batch-types'
import { decideCascadeAction } from '@/lib/batch-cascade'
import { saveQueueState, loadQueueState, clearQueueState, getInitialQueueState, registerBeforeUnload } from '@/lib/batch-storage'
import { submitTextToVideo, submitImageToVideo, submitVideoEdit, queryTask, TaskResult } from '@/lib/api'
import { useBatchLog } from './useBatchLog'

type Action =
  | { type: 'LOAD_TASKS'; tasks: BatchTaskItem[] }
  | { type: 'SET_STATUS'; status: QueueStatus }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<BatchSettings> }
  | { type: 'UPDATE_TASK'; taskId: string; updates: Partial<BatchTaskItem> }
  | { type: 'CANCEL_TASK'; taskId: string }
  | { type: 'RESET' }

function reducer(state: BatchQueueState, action: Action): BatchQueueState {
  switch (action.type) {
    case 'LOAD_TASKS':
      return { ...state, tasks: action.tasks }
    case 'SET_STATUS':
      return { ...state, status: action.status }
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } }
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.taskId ? { ...t, ...action.updates } : t
        ),
      }
    case 'CANCEL_TASK':
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.taskId && (t.status === 'queued' || t.status === 'retrying')
            ? { ...t, status: 'cancelled' }
            : t
        ),
      }
    case 'RESET':
      return getInitialQueueState()
    default:
      return state
  }
}

export function useBatchQueue(apiKey: string) {
  const savedState = loadQueueState()
  const initialState: BatchQueueState = savedState
    ? { ...savedState, status: savedState.status === 'running' ? 'paused' : savedState.status }
    : getInitialQueueState()

  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state

  const apiKeyRef = useRef(apiKey)
  apiKeyRef.current = apiKey

  const { logs, addLog, clearLogs } = useBatchLog()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processingRef = useRef<Set<string>>(new Set())
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Persist state
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveQueueState(state), 1000)
  }, [state])

  // beforeunload
  useEffect(() => {
    return registerBeforeUnload(() => stateRef.current.status === 'running')
  }, [])

  // Check completion
  useEffect(() => {
    if (state.status !== 'running') return
    const allDone = state.tasks.every(
      t => t.status === 'succeeded' || t.status === 'failed-permanent' || t.status === 'cancelled'
    )
    if (allDone && state.tasks.length > 0) {
      dispatch({ type: 'SET_STATUS', status: 'completed' })
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [state.tasks, state.status])

  const doTick = useCallback(() => {
    const { tasks, settings, status } = stateRef.current
    if (status !== 'running') return

    const activeCount = tasks.filter(
      t => t.status === 'submitting' || t.status === 'polling'
    ).length

    const slotsAvailable = settings.concurrency - activeCount
    if (slotsAvailable > 0) {
      const queued = tasks.filter(t => t.status === 'queued')
      const toSubmit = queued.slice(0, slotsAvailable)
      for (const task of toSubmit) {
        if (!processingRef.current.has(task.id)) {
          processTask(task)
        }
      }
    }

    const polling = tasks.filter(t => t.status === 'polling' && t.remoteTaskId)
    for (const task of polling) {
      if (!processingRef.current.has(`poll-${task.id}`)) {
        pollTask(task)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function processTask(task: BatchTaskItem) {
    processingRef.current.add(task.id)
    const taskIndex = stateRef.current.tasks.findIndex(t => t.id === task.id)
    dispatch({ type: 'UPDATE_TASK', taskId: task.id, updates: { status: 'submitting', startedAt: Date.now() } })
    addLog(task.id, taskIndex, '提交任务...', 'info')

    let result: TaskResult
    try {
      const def = task.definition
      const key = apiKeyRef.current
      switch (def.mode) {
        case 'text-to-video':
          result = await submitTextToVideo(key, { prompt: def.prompt, resolution: def.resolution, duration: def.duration })
          break
        case 'image-to-video':
          result = await submitImageToVideo(key, { prompt: def.prompt, imageUrl: def.imageUrl || '', resolution: def.resolution, duration: def.duration })
          break
        case 'video-edit':
          result = await submitVideoEdit(key, { prompt: def.prompt, videoUrl: def.videoUrl || '', refImageUrl: def.refImageUrl })
          break
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络异常'
      handleFailure(task, msg)
      processingRef.current.delete(task.id)
      return
    }

    if (result.taskId) {
      dispatch({ type: 'UPDATE_TASK', taskId: task.id, updates: { status: 'polling', remoteTaskId: result.taskId } })
      addLog(task.id, taskIndex, `已提交 (${result.taskId.slice(0, 8)}...)`, 'info')
    } else {
      handleFailure(task, result.message || '提交失败')
    }
    processingRef.current.delete(task.id)
  }

  async function pollTask(task: BatchTaskItem) {
    if (!task.remoteTaskId) return
    processingRef.current.add(`poll-${task.id}`)
    const taskIndex = stateRef.current.tasks.findIndex(t => t.id === task.id)

    try {
      const result = await queryTask(apiKeyRef.current, task.remoteTaskId)
      if (result.status === 'SUCCEEDED') {
        dispatch({
          type: 'UPDATE_TASK',
          taskId: task.id,
          updates: { status: 'succeeded', videoUrl: result.videoUrl, completedAt: Date.now() },
        })
        addLog(task.id, taskIndex, '生成完成', 'success')
      } else if (result.status === 'FAILED') {
        const currentTask = stateRef.current.tasks.find(t => t.id === task.id) || task
        handleFailure(currentTask, result.message || '生成失败')
      }
    } catch (e) {
      addLog(task.id, taskIndex, `轮询异常: ${e instanceof Error ? e.message : '未知'}`, 'warn')
    }
    processingRef.current.delete(`poll-${task.id}`)
  }

  function handleFailure(task: BatchTaskItem, errorMessage: string) {
    const { settings } = stateRef.current
    const currentTask = stateRef.current.tasks.find(t => t.id === task.id) || task
    const taskIndex = stateRef.current.tasks.findIndex(t => t.id === task.id)
    const decision = decideCascadeAction(currentTask, settings, errorMessage)

    dispatch({
      type: 'UPDATE_TASK',
      taskId: task.id,
      updates: {
        status: 'retrying',
        errorHistory: [...currentTask.errorHistory, { time: Date.now(), message: errorMessage }],
      },
    })
    addLog(task.id, taskIndex, `失败: ${errorMessage}`, 'error')

    switch (decision.action) {
      case 'retry': {
        addLog(task.id, taskIndex, `${(decision.delayMs || 2000) / 1000}秒后重试 (${currentTask.retryCount + 1}/${settings.maxRetries})`, 'warn')
        const timer = setTimeout(() => {
          dispatch({
            type: 'UPDATE_TASK',
            taskId: task.id,
            updates: { status: 'queued', retryCount: currentTask.retryCount + 1, remoteTaskId: undefined },
          })
          retryTimersRef.current.delete(task.id)
        }, decision.delayMs || 2000)
        retryTimersRef.current.set(task.id, timer)
        break
      }
      case 'downgrade': {
        addLog(task.id, taskIndex, `参数降级: ${decision.newResolution}/${decision.newDuration}s`, 'warn')
        dispatch({
          type: 'UPDATE_TASK',
          taskId: task.id,
          updates: {
            status: 'queued',
            retryCount: 0,
            downgradeLevel: currentTask.downgradeLevel + 1,
            remoteTaskId: undefined,
            definition: {
              ...currentTask.definition,
              resolution: decision.newResolution || currentTask.definition.resolution,
              duration: decision.newDuration || currentTask.definition.duration,
            },
          },
        })
        break
      }
      case 'simplify-prompt': {
        addLog(task.id, taskIndex, '简化Prompt重试', 'warn')
        dispatch({
          type: 'UPDATE_TASK',
          taskId: task.id,
          updates: {
            status: 'queued',
            retryCount: 0,
            promptSimplified: true,
            remoteTaskId: undefined,
            definition: {
              ...currentTask.definition,
              prompt: decision.newPrompt || currentTask.definition.prompt,
            },
          },
        })
        break
      }
      case 'fail-permanent': {
        addLog(task.id, taskIndex, '达到最大重试，标记永久失败', 'error')
        dispatch({
          type: 'UPDATE_TASK',
          taskId: task.id,
          updates: { status: 'failed-permanent', completedAt: Date.now() },
        })
        break
      }
    }
  }

  const loadTasks = useCallback((definitions: BatchTaskDefinition[]) => {
    const items: BatchTaskItem[] = definitions.map(def => ({
      id: def.id,
      definition: def,
      status: 'queued',
      retryCount: 0,
      downgradeLevel: 0,
      promptSimplified: false,
      errorHistory: [],
    }))
    dispatch({ type: 'LOAD_TASKS', tasks: items })
  }, [])

  const start = useCallback(() => {
    dispatch({ type: 'SET_STATUS', status: 'running' })
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(doTick, 5000)
    doTick()
  }, [doTick])

  const pause = useCallback(() => {
    dispatch({ type: 'SET_STATUS', status: 'paused' })
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  const resume = useCallback(() => {
    dispatch({ type: 'SET_STATUS', status: 'running' })
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(doTick, 5000)
    doTick()
  }, [doTick])

  const cancel = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    retryTimersRef.current.forEach(timer => clearTimeout(timer))
    retryTimersRef.current.clear()
    processingRef.current.clear()
    dispatch({ type: 'RESET' })
    clearQueueState()
    clearLogs()
  }, [clearLogs])

  const cancelTask = useCallback((taskId: string) => {
    dispatch({ type: 'CANCEL_TASK', taskId })
    const timer = retryTimersRef.current.get(taskId)
    if (timer) { clearTimeout(timer); retryTimersRef.current.delete(taskId) }
  }, [])

  const updateSettings = useCallback((settings: Partial<BatchSettings>) => {
    dispatch({ type: 'UPDATE_SETTINGS', settings })
  }, [])

  const hasRestoredState = savedState !== null && savedState.tasks.length > 0 && savedState.status !== 'idle'

  return { state, logs, hasRestoredState, loadTasks, start, pause, resume, cancel, cancelTask, updateSettings, addLog }
}
