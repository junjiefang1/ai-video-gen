import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, Wand2 } from 'lucide-react'
import { PromptRewriteSection } from '@/components/PromptRewriteSection'

interface ImageToVideoPanelProps {
  onSubmit: (prompt: string, imageUrl: string, resolution: string, duration: number) => void
  isSubmitting: boolean
  apiKey: string
}

export function ImageToVideoPanel({ onSubmit, isSubmitting, apiKey }: ImageToVideoPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [resolution, setResolution] = useState('720p')
  const [duration, setDuration] = useState(5)
  const [showRewrite, setShowRewrite] = useState(false)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setImagePreview(ev.target?.result as string)
      }
      reader.readAsDataURL(file)
      setImageUrl(URL.createObjectURL(file))
    }
  }

  const handleSubmit = (finalPrompt?: string) => {
    const p = finalPrompt || prompt
    if (!p.trim() || !imageUrl) return
    // imagePreview 是 base64 Data URL（DashScope 能解析），imageUrl 可能是 blob: 或用户输入的外部URL
    const submitUrl = imagePreview || imageUrl
    onSubmit(p, submitUrl, resolution, duration)
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">图生视频</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">上传首帧图片</label>
          <div className="upload-zone rounded-lg p-4 text-center cursor-pointer relative overflow-hidden">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {imagePreview ? (
              <img src={imagePreview} alt="首帧预览" className="w-full h-32 object-cover rounded-md" />
            ) : (
              <div className="flex flex-col items-center gap-2 py-4">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">点击或拖拽上传图片</p>
                <p className="text-xs text-muted-foreground">支持 JPG、PNG，建议 1280x720</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">或输入图片URL</label>
          <input
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="w-full px-3 py-2.5 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">运动描述</label>
          <textarea
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setShowRewrite(false) }}
            placeholder="描述图片中物体的运动方式，例如：镜头缓缓推进，花瓣随风飘落..."
            className="w-full h-24 px-3 py-2.5 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
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
            context="image-to-video"
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
              disabled={isSubmitting || !imageUrl || !prompt.trim()}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              AI 改写并生成
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleSubmit()}
              disabled={isSubmitting || !imageUrl || !prompt.trim()}
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
