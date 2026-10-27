import { BatchTaskItem, BatchTaskStatus } from '@/lib/batch-types'
import { X, Play, Download } from 'lucide-react'

interface BatchTaskRowProps {
  task: BatchTaskItem
  index: number
  onCancel: (taskId: string) => void
  onPreview: (videoUrl: string) => void
}

const statusLabels: Record<BatchTaskStatus, { text: string; cls: string }> = {
  queued: { text: '排队', cls: 'text-muted-foreground bg-secondary' },
  submitting: { text: '提交中', cls: 'text-primary bg-primary/10' },
  polling: { text: '生成中', cls: 'text-primary bg-primary/10' },
  retrying: { text: '重试中', cls: 'text-yellow-500 bg-yellow-500/10' },
  succeeded: { text: '完成', cls: 'text-green-500 bg-green-500/10' },
  'failed-permanent': { text: '失败', cls: 'text-destructive bg-destructive/10' },
  cancelled: { text: '已取消', cls: 'text-muted-foreground bg-secondary' },
}

export function BatchTaskRow({ task, index, onCancel, onPreview }: BatchTaskRowProps) {
  const status = statusLabels[task.status]
  const canCancel = task.status === 'queued' || task.status === 'retrying'
  const hasVideo = task.status === 'succeeded' && task.videoUrl

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/30 transition-colors">
      <span className="text-xs text-muted-foreground font-mono w-6 text-right">#{index + 1}</span>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground truncate">{task.definition.prompt}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground">{task.definition.resolution}</span>
          <span className="text-[10px] text-muted-foreground">{task.definition.duration}s</span>
          {task.retryCount > 0 && (
            <span className="text-[10px] text-yellow-500">{task.retryCount} 次重试</span>
          )}
          {task.downgradeLevel > 0 && (
            <span className="text-[10px] text-yellow-500">已降级</span>
          )}
        </div>
      </div>

      <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${status.cls}`}>
        {status.text}
      </span>

      {hasVideo && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPreview(task.videoUrl!)}
            className="text-primary hover:text-primary/80 transition-colors"
            title="预览"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
          <a
            href={task.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="下载"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      {canCancel && (
        <button
          onClick={() => onCancel(task.id)}
          className="text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
