import { useState } from 'react'
import { BatchQueueState, BatchLogEntry } from '@/lib/batch-types'
import { BatchProgressBar } from './BatchProgressBar'
import { BatchControls } from './BatchControls'
import { BatchTaskList } from './BatchTaskList'
import { BatchLogTimeline } from './BatchLogTimeline'
import { BatchExportButton } from './BatchExportButton'
import { LayoutDashboard, X } from 'lucide-react'

interface BatchDashboardProps {
  state: BatchQueueState
  logs: BatchLogEntry[]
  tasksLoaded: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onCancelTask: (taskId: string) => void
}

export function BatchDashboard({
  state,
  logs,
  tasksLoaded,
  onStart,
  onPause,
  onResume,
  onCancel,
  onCancelTask,
}: BatchDashboardProps) {
  const { tasks, status } = state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  if (!tasksLoaded && tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <LayoutDashboard className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">加载任务后开始批量生成</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden flex flex-col">
      {/* Video Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setPreviewUrl(null)} />
          <div className="relative w-full max-w-3xl mx-4 rounded-xl border border-border bg-card overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
              <span className="text-sm font-medium text-foreground">视频预览</span>
              <button onClick={() => setPreviewUrl(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <video src={previewUrl} controls autoPlay className="w-full aspect-video bg-background" />
            <div className="px-4 py-2 border-t border-border/50">
              <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                在新标签页打开 / 下载
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="p-4 border-b border-border/50 space-y-3">
        <BatchProgressBar tasks={tasks} />
        <div className="flex items-center gap-2">
          <BatchControls status={status} onStart={onStart} onPause={onPause} onResume={onResume} onCancel={onCancel} hasTask={tasks.length > 0} />
          <BatchExportButton tasks={tasks} />
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 min-h-0 max-h-[280px] overflow-y-auto">
        <BatchTaskList tasks={tasks} onCancelTask={onCancelTask} onPreview={setPreviewUrl} />
      </div>

      {/* Log */}
      <div className="border-t border-border/50">
        <BatchLogTimeline logs={logs} />
      </div>
    </div>
  )
}
