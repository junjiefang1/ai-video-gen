import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Wand2 } from 'lucide-react'
import { PromptRewriteSection } from '@/components/PromptRewriteSection'

interface TextToVideoPanelProps {
  onSubmit: (prompt: string, resolution: string, duration: number) => void
  isSubmitting: boolean
  apiKey: string
}

export function TextToVideoPanel({ onSubmit, isSubmitting, apiKey }: TextToVideoPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [resolution, setResolution] = useState('720p')
  const [duration, setDuration] = useState(5)
  const [showRewrite, setShowRewrite] = useState(false)

  const handleSubmit = (finalPrompt?: string) => {
    const p = finalPrompt || prompt
    if (!p.trim()) return
    onSubmit(p, resolution, duration)
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">文本描述</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">描述你想要生成的视频内容</label>
          <textarea
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setShowRewrite(false) }}
            placeholder="例如：一只金色的猎豹在非洲草原上奔跑，背景是壮丽的落日，电影级画质..."
            className="w-full h-32 px-3 py-2.5 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
          <p className="text-xs text-muted-foreground">{prompt.length}/500 字符</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">分辨率</label>
          <div className="flex gap-2">
            {['480p', '720p', '1080p'].map((r) => (
              <button
                key={r}
                onClick={() => setResolution(r)}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                  resolution === r
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">时长 (秒)</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={2}
              max={10}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="flex-1 accent-[hsl(262,83%,62%)]"
            />
            <span className="text-sm font-medium text-foreground w-8 text-right">{duration}s</span>
          </div>
        </div>

        {/* AI 改写区域 */}
        {showRewrite ? (
          <PromptRewriteSection
            apiKey={apiKey}
            prompt={prompt}
            context="text-to-video"
            duration={duration}
            resolution={resolution}
            onConfirm={(rewritten) => { setShowRewrite(false); handleSubmit(rewritten) }}
            onCancel={() => setShowRewrite(false)}
          />
        ) : (
          <div className="space-y-2">
            <Button
              variant="gradient"
              className="w-full h-11"
              onClick={() => setShowRewrite(true)}
              disabled={isSubmitting || !prompt.trim()}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              AI 改写并生成
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleSubmit()}
              disabled={isSubmitting || !prompt.trim()}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
                  生成中...
                </span>
              ) : '跳过改写，直接生成'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
