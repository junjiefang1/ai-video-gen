import { BatchTaskItem } from '@/lib/batch-types'

interface BatchProgressBarProps {
  tasks: BatchTaskItem[]
}

export function BatchProgressBar({ tasks }: BatchProgressBarProps) {
  const total = tasks.length
  const succeeded = tasks.filter(t => t.status === 'succeeded').length
  const failed = tasks.filter(t => t.status === 'failed-permanent').length
  const cancelled = tasks.filter(t => t.status === 'cancelled').length
  const completed = succeeded + failed + cancelled
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          进度: <span className="text-foreground font-medium">{completed}/{total}</span>
        </span>
        <span className="text-muted-foreground">
          <span className="text-green-500">{succeeded}</span>
          {failed > 0 && <> / <span className="text-destructive">{failed} 失败</span></>}
          {cancelled > 0 && <> / <span className="text-muted-foreground">{cancelled} 取消</span></>}
        </span>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full gradient-primary transition-all duration-500 rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
