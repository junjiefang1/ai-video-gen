import { useState } from 'react'
import { useBatchQueue } from '@/hooks/useBatchQueue'
import { BatchTaskDefinition } from '@/lib/batch-types'
import { BatchInputSection } from './BatchInputSection'
import { BatchDashboard } from './BatchDashboard'
import { BatchSettingsPanel } from './BatchSettingsPanel'

interface BatchPanelProps {
  apiKey: string
  showToast: (message: string, type: 'success' | 'error' | 'info') => void
}

export function BatchPanel({ apiKey, showToast }: BatchPanelProps) {
  const queue = useBatchQueue(apiKey)
  const [tasksLoaded, setTasksLoaded] = useState(queue.state.tasks.length > 0)

  const handleLoadTasks = (tasks: BatchTaskDefinition[]) => {
    if (tasks.length === 0) {
      showToast('没有有效的任务', 'error')
      return
    }
    queue.loadTasks(tasks)
    setTasksLoaded(true)
    showToast(`已加载 ${tasks.length} 个任务`, 'success')
  }

  const handleStart = () => {
    if (!apiKey) {
      showToast('请先设置 API Key', 'error')
      return
    }
    queue.start()
    showToast('批量生成已启动', 'info')
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
      {/* Left: Input & Settings */}
      <div className="space-y-4">
        <BatchInputSection onLoadTasks={handleLoadTasks} disabled={queue.state.status === 'running'} apiKey={apiKey} />
        <BatchSettingsPanel settings={queue.state.settings} onUpdate={queue.updateSettings} disabled={queue.state.status === 'running'} />
      </div>

      {/* Right: Dashboard */}
      <BatchDashboard
        state={queue.state}
        logs={queue.logs}
        tasksLoaded={tasksLoaded}
        onStart={handleStart}
        onPause={queue.pause}
        onResume={queue.resume}
        onCancel={queue.cancel}
        onCancelTask={queue.cancelTask}
      />
    </div>
  )
}
