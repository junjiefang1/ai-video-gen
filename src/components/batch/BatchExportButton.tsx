import { BatchTaskItem, ExportResultItem } from '@/lib/batch-types'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'

interface BatchExportButtonProps {
  tasks: BatchTaskItem[]
}

export function BatchExportButton({ tasks }: BatchExportButtonProps) {
  const completedCount = tasks.filter(t => t.status === 'succeeded').length

  const handleExport = () => {
    const results: ExportResultItem[] = tasks.map((task, index) => ({
      index: index + 1,
      prompt: task.definition.prompt,
      mode: task.definition.mode,
      resolution: task.definition.resolution,
      duration: task.definition.duration,
      status: task.status,
      videoUrl: task.videoUrl,
      error: task.errorHistory.length > 0 ? task.errorHistory[task.errorHistory.length - 1].message : undefined,
      retryCount: task.retryCount,
    }))

    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch-results-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleExport} disabled={completedCount === 0}>
      <Download className="h-3.5 w-3.5 mr-1" />
      导出
    </Button>
  )
}
