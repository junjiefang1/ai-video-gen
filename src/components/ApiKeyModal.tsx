import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Key, X, ImageIcon } from 'lucide-react'

interface ApiKeyModalProps {
  currentKey: string
  currentImgbbKey: string
  onSave: (key: string, imgbbKey: string) => void
  onClose: () => void
}

export function ApiKeyModal({ currentKey, currentImgbbKey, onSave, onClose }: ApiKeyModalProps) {
  const [key, setKey] = useState(currentKey)
  const [imgbbKey, setImgbbKey] = useState(currentImgbbKey)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 rounded-xl border border-border bg-card p-6 shadow-lg">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">API Key 设置</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">DashScope API Key</label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2.5 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            />
            <p className="text-xs text-muted-foreground">
              请在阿里云百炼控制台获取 API Key，存储在本地浏览器中。
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" />
              ImgBB API Key（可选）
            </label>
            <input
              type="password"
              value={imgbbKey}
              onChange={(e) => setImgbbKey(e.target.value)}
              placeholder="在 https://api.imgbb.com/ 获取"
              className="w-full px-3 py-2.5 rounded-lg bg-secondary/50 border border-input text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            />
            <p className="text-xs text-muted-foreground">
              用于把本地首帧/尾帧图上传到公网图床，供 Muledance/Seedance 首尾帧硬锁使用。不配置时只能手动粘贴公网图片 URL。
            </p>
          </div>

          <Button
            variant="gradient"
            className="w-full"
            onClick={() => onSave(key, imgbbKey)}
            disabled={!key.trim()}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
