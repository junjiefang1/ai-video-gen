import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, Wand2, ImagePlus } from 'lucide-react'
import { PromptRewriteSection } from '@/components/PromptRewriteSection'

interface VideoEditPanelProps {
  onSubmit: (prompt: string, videoUrl: string, refImageUrl?: string) => void
  isSubmitting: boolean
  apiKey: string
}

export function VideoEditPanel({ onSubmit, isSubmitting, apiKey }: VideoEditPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [refImageUrl, setRefImageUrl] = useState('')
  const [videoFileName, setVideoFileName] = useState('')
  const [refImagePreview, setRefImagePreview] = useState<string | null>(null)
  const [showRewrite, setShowRewrite] = useState(false)

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setVideoFileName(file.name)
      setVideoUrl(URL.createObjectURL(file))
    }
  }

  const handleRefImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setRefImagePreview(ev.target?.result as string)
      }
      reader.readAsDataURL(file)
      setRefImageUrl(URL.createObjectURL(file))
    }
  }

  const handleSubmit = (finalPrompt?: string) => {
    const p = finalPrompt || prompt
    if (!p.trim() || !videoUrl) return
    onSubmit(p, videoUrl, refImageUrl || undefined)
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">视频编辑</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">上传源视频</label>
          <div className="upload-zone rounded-lg p-4 text-center cursor-pointer relative overflow-hidden">
            <input
              type="file"
              accept="video/*"
              onChange={handleVideoUpload}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {videoFileName ? (
              <div className="flex items-center gap-2 justify-center py-2">
                <Upload className="h-5 w-5 text-primary" />
                <p className="text-sm text-foreground">{videoFileName}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-4">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">点击或拖拽上传视频</p>
                <p className="text-xs text-muted-foreground">支持 MP4、MOV 格式</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">或输入视频URL</label>
          <input
            type="text"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://example.com/video.mp4"
            className="w-full px-3 py-2.5 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">参考图（可选，用于风格/角色替换）</label>
          <div className="upload-zone rounded-lg p-3 text-center cursor-pointer relative overflow-hidden">
            <input
              type="file"
              accept="image/*"
              onChange={handleRefImageUpload}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {refImagePreview ? (
              <img src={refImagePreview} alt="参考图" className="w-full h-24 object-cover rounded-md" />
            ) : (
              <div className="flex items-center gap-2 justify-center py-2">
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">添加参考图</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">编辑指令</label>
          <textarea
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setShowRewrite(false) }}
            placeholder="描述你想对视频进行的编辑，例如：将视频风格转换为赛博朋克风格，保持人物动作不变..."
            className="w-full h-28 px-3 py-2.5 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-all"
          />
        </div>

        {/* AI 改写区域 */}
        {showRewrite ? (
          <PromptRewriteSection
            apiKey={apiKey}
            prompt={prompt}
            context="video-edit"
            onConfirm={(rewritten) => { setShowRewrite(false); handleSubmit(rewritten) }}
            onCancel={() => setShowRewrite(false)}
          />
        ) : (
          <div className="space-y-2">
            <Button
              variant="gradient"
              className="w-full h-11"
              onClick={() => setShowRewrite(true)}
              disabled={isSubmitting || !videoUrl || !prompt.trim()}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              AI 改写并编辑
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleSubmit()}
              disabled={isSubmitting || !videoUrl || !prompt.trim()}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
                  处理中...
                </span>
              ) : '跳过改写，直接编辑'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
