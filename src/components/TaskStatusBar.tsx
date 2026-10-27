import { TaskResult } from '@/lib/api'
import { Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react'

interface TaskStatusBarProps {
  taskResult: TaskResult | null
}

export function TaskStatusBar({ taskResult }: TaskStatusBarProps) {
  if (!taskResult || !taskResult.taskId) return null

  const statusConfig = {
    PENDING: { icon: Clock, label: '排队中', color: 'text-muted-foreground' },
    RUNNING: { icon: Loader2, label: '生成中', color: 'text-primary' },
    SUCCEEDED: { icon: CheckCircle2, label: '已完成', color: 'text-green-500' },
    FAILED: { icon: XCircle, label: '失败', color: 'text-destructive' },
    UNKNOWN: { icon: Clock, label: '未知', color: 'text-muted-foreground' },
  }

  const config = statusConfig[taskResult.status]
  const Icon = config.icon

  return (
    <div className="mt-4 px-4 py-3 rounded-lg bg-secondary/50 border border-border/50 flex items-center gap-3">
      <Icon className={`h-4 w-4 ${config.color} ${taskResult.status === 'RUNNING' ? 'animate-spin' : ''}`} />
      <div className="flex-1 flex items-center gap-3">
        <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
        {taskResult.taskId && (
          <span className="text-xs text-muted-foreground font-mono">ID: {taskResult.taskId.slice(0, 12)}...</span>
        )}
      </div>
      {taskResult.status === 'SUCCEEDED' && taskResult.videoUrl && (
        <a
          href={taskResult.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline"
        >
          下载视频
        </a>
      )}
    </div>
  )
}
