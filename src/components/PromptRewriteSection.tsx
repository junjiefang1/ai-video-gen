import { useState, useCallback, useEffect } from 'react'
import { Sparkles, Pencil, RotateCcw, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { rewritePrompt, RewriteResult, RewriteContext } from '@/lib/prompt-rewrite'

interface PromptRewriteSectionProps {
  apiKey: string
  prompt: string
  context: RewriteContext
  duration?: number
  resolution?: string
  imageDataUrls?: string[]
  onConfirm: (rewrittenPrompt: string) => void
  onCancel: () => void
  disabled?: boolean
}

/**
 * 通用 Prompt 改写组件
 * 展示"AI改写"按钮 → 调用Qwen → 展示结果 → 用户确认/编辑/重试
 */
export function PromptRewriteSection({
  apiKey,
  prompt,
  context,
  duration,
  resolution,
  imageDataUrls,
  onConfirm,
  onCancel,
  disabled,
}: PromptRewriteSectionProps) {
  const [phase, setPhase] = useState<'idle' | 'rewriting' | 'review'>('idle')
  const [result, setResult] = useState<RewriteResult | null>(null)
  const [editedPrompt, setEditedPrompt] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState('')

  const handleRewrite = useCallback(async () => {
    if (!prompt.trim() || !apiKey) return

    setPhase('rewriting')
    setError('')

    try {
      const res = await rewritePrompt(apiKey, prompt, context, { duration, resolution, imageDataUrls })
      // 防御：rewritten 必须是 string，防止 API 返回对象导致渲染崩溃
      const safeRewritten = typeof res.rewritten === 'string' ? res.rewritten : JSON.stringify(res.rewritten || '')
      setResult({ ...res, rewritten: safeRewritten })
      setEditedPrompt(safeRewritten)
      setPhase('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : '改写失败，请重试')
      setPhase('idle')
    }
  }, [apiKey, prompt, context, duration, resolution, imageDataUrls])

  // 组件挂载时自动触发改写
  useEffect(() => {
    handleRewrite()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleConfirm = () => {
    const safe = typeof editedPrompt === 'string' ? editedPrompt : JSON.stringify(editedPrompt || '')
    onConfirm(safe.trim() || prompt)
  }

  if (phase === 'idle') {
    return (
      <div className="space-y-2">
        {error && (
          <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 border-primary/30 text-primary hover:bg-primary/5"
          onClick={handleRewrite}
          disabled={disabled || !prompt.trim()}
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI 改写 Prompt（添加运镜/光线/氛围）
        </Button>
      </div>
    )
  }

  if (phase === 'rewriting') {
    return (
      <div className="flex items-center justify-center gap-2 py-3 rounded-lg bg-primary/5 border border-primary/20">
        <span className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-primary">AI 正在改写中...</span>
      </div>
    )
  }

  // phase === 'review'
  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3 animate-in fade-in-50 duration-300">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-primary flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          AI 改写结果
        </span>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-secondary transition-colors"
        >
          <Pencil className="h-2.5 w-2.5" />
          {isEditing ? '完成' : '微调'}
        </button>
      </div>

      {isEditing ? (
        <textarea
          value={editedPrompt}
          onChange={(e) => setEditedPrompt(e.target.value)}
          className="w-full h-32 px-2.5 py-2 rounded bg-background border border-input text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring font-mono"
        />
      ) : (
        <div className="space-y-1.5">
          {String(editedPrompt || '').split('\n').filter(l => l.trim()).map((line, i) => {
            const tagMatch = line.match(/^【(.+?)】(.*)/)
            if (tagMatch) {
              return (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-[10px] font-bold text-primary bg-primary/15 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                    {tagMatch[1]}
                  </span>
                  <span className="text-xs text-foreground leading-relaxed">{tagMatch[2].trim()}</span>
                </div>
              )
            }
            return <p key={i} className="text-xs text-foreground leading-relaxed">{line}</p>
          })}
        </div>
      )}

      {/* 改写亮点 */}
      {result && result.highlights.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.highlights.map((h, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {h}
            </span>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <Button size="sm" variant="default" className="flex-1 h-8 text-xs" onClick={handleConfirm}>
          <Check className="h-3 w-3 mr-1" />
          使用改写版本
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs px-2" onClick={handleRewrite} title="重新改写">
          <RotateCcw className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs px-2" onClick={onCancel} title="放弃改写">
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
