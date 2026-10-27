import { useState, useCallback, useRef } from 'react'
import { BatchLogEntry } from '@/lib/batch-types'
import { saveLogs, loadLogs } from '@/lib/batch-storage'

const MAX_ENTRIES = 500

export function useBatchLog() {
  const [logs, setLogs] = useState<BatchLogEntry[]>(() => loadLogs())
  const logsRef = useRef(logs)
  logsRef.current = logs

  const addLog = useCallback((
    taskId: string,
    taskIndex: number,
    event: string,
    level: BatchLogEntry['level']
  ) => {
    const entry: BatchLogEntry = {
      timestamp: Date.now(),
      taskId,
      taskIndex,
      event,
      level,
    }
    setLogs(prev => {
      const next = [...prev, entry].slice(-MAX_ENTRIES)
      saveLogs(next)
      return next
    })
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
    saveLogs([])
  }, [])

  return { logs, addLog, clearLogs }
}
