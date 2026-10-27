import { useState } from 'react'
import { BatchTaskDefinition } from '@/lib/batch-types'
import { VideoMode } from '@/lib/api'
import { parseMultiPrompt } from '@/lib/batch-parser'
import { rewritePromptBatch, RewriteResult } from '@/lib/prompt-rewrite'
import { Button } from '@/components/ui/button'
import { Plus, Sparkles } from 'lucide-react'

interface MultiPromptInputProps {
  onLoad: (tasks: BatchTaskDefinition[]) => void
  disabled: boolean
  apiKey: string
}

export function MultiPromptInput({ onLoad, disabled, apiKey }: MultiPromptInputProps) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<VideoMode>('text-to-video')
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>('720p')
  const [duration, setDuration] = useState(5)
  const [isRewriting, setIsRewriting] = useState(false)
  const [rewriteProgress, setRewriteProgress] = useState('')

  const lineCount = text.split('\n').filter(l => l.trim()).length

  const handleLoad = () => {
    const tasks = parseMultiPrompt(text, mode, resolution, duration)
    onLoad(tasks)
  }

  const handleRewriteAll = async () => {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length === 0 || !apiKey) return

    setIsRewriting(true)
    setRewriteProgress(`改写中 0/${lines.length}...`)

    try {
      const results: RewriteResult[] = await rewritePromptBatch(
        apiKey,
        lines,
        'batch',
        { duration, resolution },
        (done, total) => setRewriteProgress(`改写中 ${done}/${total}...`)
      )
      const rewrittenText = results.map(r => r.rewritten).join('\n')
      setText(rewrittenText)
      setRewriteProgress('')
    } catch (e) {
      setRewriteProgress(`改写失败: ${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setIsRewriting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">每行一条Prompt</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled || isRewriting}
          placeholder={"一只猎豹在草原奔跑\n星空下的古老城堡\n海浪拍打礁石的慢镜头"}
          className="w-full h-28 px-3 py-2 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-all disabled:opacity-50"
        />
        <p className="text-xs text-muted-foreground">{lineCount} 条任务</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">模式</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as VideoMode)}
            disabled={disabled || isRewriting}
            className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-input text-xs text-foreground"
          >
            <option value="text-to-video">文生视频</option>
            <option value="image-to-video">图生视频</option>
            <option value="video-edit">视频编辑</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">分辨率</label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as '480p' | '720p' | '1080p')}
            disabled={disabled || isRewriting}
            className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-input text-xs text-foreground"
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">时长</label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            disabled={disabled || isRewriting}
            className="w-full px-2 py-1.5 rounded bg-secondary/50 border border-input text-xs text-foreground"
          >
            <option value={3}>3秒</option>
            <option value={5}>5秒</option>
            <option value={7}>7秒</option>
            <option value={10}>10秒</option>
          </select>
        </div>
      </div>

      {/* 改写进度/错误提示 */}
      {rewriteProgress && (
        <p className={`text-xs px-2 py-1.5 rounded ${rewriteProgress.includes('失败') ? 'text-destructive bg-destructive/10' : 'text-primary bg-primary/10'}`}>
          {rewriteProgress}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
          onClick={handleRewriteAll}
          disabled={disabled || isRewriting || lineCount === 0 || !apiKey}
        >
          {isRewriting ? (
            <span className="h-3 w-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          AI 改写全部
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handleLoad}
          disabled={disabled || isRewriting || lineCount === 0}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          加载 {lineCount} 个任务
        </Button>
      </div>
    </div>
  )
}
