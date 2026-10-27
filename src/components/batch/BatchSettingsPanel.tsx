import { BatchSettings } from '@/lib/batch-types'
import { Settings2 } from 'lucide-react'

interface BatchSettingsPanelProps {
  settings: BatchSettings
  onUpdate: (s: Partial<BatchSettings>) => void
  disabled: boolean
}

export function BatchSettingsPanel({ settings, onUpdate, disabled }: BatchSettingsPanelProps) {
  return (
    <div className="rounded-lg border border-border/50 bg-card p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        执行设置
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">并发数</label>
            <span className="text-xs font-medium text-foreground">{settings.concurrency}</span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            value={settings.concurrency}
            onChange={(e) => onUpdate({ concurrency: Number(e.target.value) })}
            disabled={disabled}
            className="w-full accent-[hsl(262,83%,62%)]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>1</span><span>5</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">最大重试次数</label>
            <span className="text-xs font-medium text-foreground">{settings.maxRetries}</span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            value={settings.maxRetries}
            onChange={(e) => onUpdate({ maxRetries: Number(e.target.value) })}
            disabled={disabled}
            className="w-full accent-[hsl(262,83%,62%)]"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoDowngrade}
            onChange={(e) => onUpdate({ autoDowngrade: e.target.checked })}
            disabled={disabled}
            className="rounded accent-[hsl(262,83%,62%)]"
          />
          <span className="text-xs text-foreground">自动降级参数</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoPromptSimplify}
            onChange={(e) => onUpdate({ autoPromptSimplify: e.target.checked })}
            disabled={disabled}
            className="rounded accent-[hsl(262,83%,62%)]"
          />
          <span className="text-xs text-foreground">自动简化Prompt</span>
        </label>
      </div>
    </div>
  )
}
