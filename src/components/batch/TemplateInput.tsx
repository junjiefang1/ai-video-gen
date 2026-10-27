import { useState } from 'react'
import { BatchTaskDefinition } from '@/lib/batch-types'
import { VideoMode } from '@/lib/api'
import { expandTemplate } from '@/lib/batch-parser'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

interface TemplateInputProps {
  onLoad: (tasks: BatchTaskDefinition[]) => void
  disabled: boolean
}

export function TemplateInput({ onLoad, disabled }: TemplateInputProps) {
  const [template, setTemplate] = useState('')
  const [mode, setMode] = useState<VideoMode>('text-to-video')
  const [resolutions, setResolutions] = useState<('480p' | '720p' | '1080p')[]>(['720p'])
  const [durations, setDurations] = useState<number[]>([5])

  const taskCount = resolutions.length * durations.length

  const toggleResolution = (r: '480p' | '720p' | '1080p') => {
    setResolutions(prev =>
      prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]
    )
  }

  const toggleDuration = (d: number) => {
    setDurations(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    )
  }

  const handleLoad = () => {
    const tasks = expandTemplate({ promptTemplate: template, mode, resolutions, durations })
    onLoad(tasks)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Prompt 模板</label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          disabled={disabled}
          placeholder="一只金色猎豹在草原上奔跑，画面风格为电影级"
          className="w-full h-20 px-3 py-2 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-all disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">模式</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as VideoMode)}
          disabled={disabled}
          className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-input text-xs text-foreground"
        >
          <option value="text-to-video">文生视频</option>
          <option value="image-to-video">图生视频</option>
          <option value="video-edit">视频编辑</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">分辨率组合</label>
        <div className="flex gap-2">
          {(['480p', '720p', '1080p'] as const).map(r => (
            <button
              key={r}
              onClick={() => toggleResolution(r)}
              disabled={disabled}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-all ${
                resolutions.includes(r)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">时长组合</label>
        <div className="flex gap-2">
          {[3, 5, 7, 10].map(d => (
            <button
              key={d}
              onClick={() => toggleDuration(d)}
              disabled={disabled}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-all ${
                durations.includes(d)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {d}s
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        将生成 {taskCount} 个任务（{resolutions.length} 分辨率 x {durations.length} 时长）
      </p>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={handleLoad}
        disabled={disabled || !template.trim() || taskCount === 0}
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        加载 {taskCount} 个任务
      </Button>
    </div>
  )
}
