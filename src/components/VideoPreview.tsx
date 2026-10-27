import { TaskResult } from '@/lib/api'
import { Play, Video } from 'lucide-react'

interface VideoPreviewProps {
  taskResult: TaskResult | null
}

export function VideoPreview({ taskResult }: VideoPreviewProps) {
  const isGenerating = taskResult?.status === 'PENDING' || taskResult?.status === 'RUNNING'
  const isComplete = taskResult?.status === 'SUCCEEDED' && taskResult.videoUrl

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
        <Video className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">预览</span>
      </div>

      <div className="flex-1 flex items-center justify-center min-h-[400px] relative" style={{ backgroundImage: 'url(/images/bg-hero.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        {isComplete && taskResult.videoUrl ? (
          <video
            src={taskResult.videoUrl}
            controls
            className="w-full h-full object-contain bg-background"
            autoPlay
          />
        ) : isGenerating ? (
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full gradient-primary opacity-20 animate-pulse-glow" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-10 w-10 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                {taskResult?.status === 'PENDING' ? '排队中...' : '正在生成视频...'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">预计需要 1-3 分钟，请耐心等待</p>
            </div>
          </div>
        ) : taskResult?.status === 'FAILED' ? (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <span className="text-lg text-destructive">!</span>
            </div>
            <p className="text-sm text-foreground">生成失败</p>
            <p className="text-xs text-muted-foreground">{taskResult.message || '请检查参数后重试'}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center px-6">
            <div className="h-20 w-20 rounded-2xl bg-secondary/50 flex items-center justify-center">
              <Play className="h-8 w-8 text-muted-foreground ml-1" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">等待生成</p>
              <p className="text-xs text-muted-foreground mt-1">配置参数并点击生成按钮开始</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
