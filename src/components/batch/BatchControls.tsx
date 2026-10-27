import { QueueStatus } from '@/lib/batch-types'
import { Button } from '@/components/ui/button'
import { Play, Pause, RotateCcw, Square } from 'lucide-react'

interface BatchControlsProps {
  status: QueueStatus
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  hasTask: boolean
}

export function BatchControls({ status, onStart, onPause, onResume, onCancel, hasTask }: BatchControlsProps) {
  return (
    <div className="flex items-center gap-2 flex-1">
      {status === 'idle' && (
        <Button variant="gradient" size="sm" onClick={onStart} disabled={!hasTask}>
          <Play className="h-3.5 w-3.5 mr-1" />
          开始
        </Button>
      )}
      {status === 'running' && (
        <Button variant="outline" size="sm" onClick={onPause}>
          <Pause className="h-3.5 w-3.5 mr-1" />
          暂停
        </Button>
      )}
      {status === 'paused' && (
        <Button variant="gradient" size="sm" onClick={onResume}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          恢复
        </Button>
      )}
      {status === 'completed' && (
        <Button variant="outline" size="sm" onClick={onCancel}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          重置
        </Button>
      )}
      {(status === 'running' || status === 'paused') && (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <Square className="h-3.5 w-3.5 mr-1" />
          取消全部
        </Button>
      )}
    </div>
  )
}
