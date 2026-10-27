import { useRef, useEffect } from 'react'
import { BatchLogEntry } from '@/lib/batch-types'

interface BatchLogTimelineProps {
  logs: BatchLogEntry[]
}

const levelColors: Record<string, string> = {
  info: 'text-muted-foreground',
  warn: 'text-yellow-500',
  error: 'text-destructive',
  success: 'text-green-500',
}

export function BatchLogTimeline({ logs }: BatchLogTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs])

  const recentLogs = logs.slice(-50)

  return (
    <div className="px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">实时日志</p>
      <div ref={containerRef} className="max-h-[120px] overflow-y-auto space-y-0.5">
        {recentLogs.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">等待执行...</p>
        ) : (
          recentLogs.map((log, i) => (
            <div key={i} className="flex items-start gap-2 text-[10px]">
              <span className="text-muted-foreground shrink-0">
                {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="text-muted-foreground shrink-0">#{log.taskIndex + 1}</span>
              <span className={levelColors[log.level] || 'text-foreground'}>{log.event}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
