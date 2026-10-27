import { BatchTaskItem } from '@/lib/batch-types'
import { BatchTaskRow } from './BatchTaskRow'

interface BatchTaskListProps {
  tasks: BatchTaskItem[]
  onCancelTask: (taskId: string) => void
  onPreview: (videoUrl: string) => void
}

export function BatchTaskList({ tasks, onCancelTask, onPreview }: BatchTaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        暂无任务
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/30">
      {tasks.map((task, index) => (
        <BatchTaskRow key={task.id} task={task} index={index} onCancel={onCancelTask} onPreview={onPreview} />
      ))}
    </div>
  )
}
