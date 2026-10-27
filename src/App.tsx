import { useState, useCallback } from 'react'
import { TaskResult, submitTextToVideo, submitImageToVideo, submitVideoEdit, queryTask } from '@/lib/api'
import { AppMode } from '@/lib/batch-types'
import { Header } from '@/components/Header'
import { TabNav } from '@/components/TabNav'
import { TextToVideoPanel } from '@/components/TextToVideoPanel'
import { ImageToVideoPanel } from '@/components/ImageToVideoPanel'
import { VideoEditPanel } from '@/components/VideoEditPanel'
import { VideoPreview } from '@/components/VideoPreview'
import { TaskStatusBar } from '@/components/TaskStatusBar'
import { ApiKeyModal } from '@/components/ApiKeyModal'
import { Toast } from '@/components/Toast'
import { BatchPanel } from '@/components/batch/BatchPanel'
import { LongVideoPanel } from '@/components/LongVideoPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'

function App() {
  const [activeMode, setActiveMode] = useState<AppMode>('text-to-video')
  const [apiKey, setApiKey] = useState<string>(localStorage.getItem('dashscope_api_key') || '')
  const [imgbbKey, setImgbbKey] = useState<string>(localStorage.getItem('imgbb_api_key') || '')
  const [showApiKeyModal, setShowApiKeyModal] = useState(!apiKey)
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const handleSaveApiKey = useCallback((key: string, imgbb?: string) => {
    setApiKey(key)
    localStorage.setItem('dashscope_api_key', key)
    if (imgbb !== undefined) {
      setImgbbKey(imgbb)
      localStorage.setItem('imgbb_api_key', imgbb)
    }
    setShowApiKeyModal(false)
    showToast('设置已保存', 'success')
  }, [showToast])

  const pollTaskStatus = useCallback(async (taskId: string) => {
    const poll = async () => {
      const result = await queryTask(apiKey, taskId)
      setTaskResult(result)
      if (result.status === 'PENDING' || result.status === 'RUNNING') {
        setTimeout(poll, 5000)
      } else if (result.status === 'SUCCEEDED') {
        showToast('视频生成完成！', 'success')
      } else if (result.status === 'FAILED') {
        showToast(result.message || '视频生成失败', 'error')
      }
    }
    await poll()
  }, [apiKey, showToast])

  const handleSubmitTextToVideo = useCallback(async (prompt: string, resolution: string, duration: number) => {
    if (!apiKey) { setShowApiKeyModal(true); return }
    setIsSubmitting(true)
    try {
      const result = await submitTextToVideo(apiKey, { prompt, resolution: resolution as '480p' | '720p' | '1080p', duration })
      setTaskResult(result)
      if (result.taskId) {
        showToast('任务已提交，正在生成中...', 'info')
        pollTaskStatus(result.taskId)
      } else {
        showToast(result.message || '提交失败', 'error')
      }
    } catch (e) {
      showToast(`请求异常: ${e instanceof Error ? e.message : '未知错误'}`, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [apiKey, showToast, pollTaskStatus])

  const handleSubmitImageToVideo = useCallback(async (prompt: string, imageUrl: string, resolution: string, duration: number) => {
    if (!apiKey) { setShowApiKeyModal(true); return }
    setIsSubmitting(true)
    try {
      const result = await submitImageToVideo(apiKey, { prompt, imageUrl, resolution: resolution as '480p' | '720p' | '1080p', duration })
      setTaskResult(result)
      if (result.taskId) {
        showToast('任务已提交，正在生成中...', 'info')
        pollTaskStatus(result.taskId)
      } else {
        showToast(result.message || '提交失败', 'error')
      }
    } catch (e) {
      showToast(`请求异常: ${e instanceof Error ? e.message : '未知错误'}`, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [apiKey, showToast, pollTaskStatus])

  const handleSubmitVideoEdit = useCallback(async (prompt: string, videoUrl: string, refImageUrl?: string) => {
    if (!apiKey) { setShowApiKeyModal(true); return }
    setIsSubmitting(true)
    try {
      const result = await submitVideoEdit(apiKey, { prompt, videoUrl, refImageUrl })
      setTaskResult(result)
      if (result.taskId) {
        showToast('任务已提交，正在处理中...', 'info')
        pollTaskStatus(result.taskId)
      } else {
        showToast(result.message || '提交失败', 'error')
      }
    } catch (e) {
      showToast(`请求异常: ${e instanceof Error ? e.message : '未知错误'}`, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [apiKey, showToast, pollTaskStatus])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header onOpenSettings={() => setShowApiKeyModal(true)} />

      <main className="flex-1 flex flex-col max-w-[1440px] mx-auto w-full px-6 pb-6">
        <TabNav activeMode={activeMode} onChange={setActiveMode} />

        <div className="flex-1 mt-6">
          {activeMode === 'batch' ? (
            <BatchPanel apiKey={apiKey} showToast={showToast} />
          ) : activeMode === 'long-video' ? (
            <ErrorBoundary>
              <LongVideoPanel apiKey={apiKey} imgbbKey={imgbbKey} showToast={showToast} />
            </ErrorBoundary>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
              <div className="space-y-4">
                {activeMode === 'text-to-video' && (
                  <TextToVideoPanel onSubmit={handleSubmitTextToVideo} isSubmitting={isSubmitting} apiKey={apiKey} />
                )}
                {activeMode === 'image-to-video' && (
                  <ImageToVideoPanel onSubmit={handleSubmitImageToVideo} isSubmitting={isSubmitting} apiKey={apiKey} />
                )}
                {activeMode === 'video-edit' && (
                  <VideoEditPanel onSubmit={handleSubmitVideoEdit} isSubmitting={isSubmitting} apiKey={apiKey} />
                )}
              </div>
              <VideoPreview taskResult={taskResult} />
            </div>
          )}

          {activeMode !== 'batch' && activeMode !== 'long-video' && <TaskStatusBar taskResult={taskResult} />}
        </div>
      </main>

      {showApiKeyModal && (
        <ApiKeyModal
          currentKey={apiKey}
          currentImgbbKey={imgbbKey}
          onSave={handleSaveApiKey}
          onClose={() => { if (apiKey) setShowApiKeyModal(false) }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

export default App
