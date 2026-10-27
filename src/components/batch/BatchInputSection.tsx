import { useState } from 'react'
import { BatchTaskDefinition, BatchSourceType } from '@/lib/batch-types'
import { cn } from '@/lib/utils'
import { MultiPromptInput } from './MultiPromptInput'
import { FileUploadInput } from './FileUploadInput'
import { TemplateInput } from './TemplateInput'
import { List, FileUp, Grid3X3 } from 'lucide-react'

interface BatchInputSectionProps {
  onLoadTasks: (tasks: BatchTaskDefinition[]) => void
  disabled: boolean
  apiKey: string
}

const sources: { type: BatchSourceType; label: string; icon: typeof List }[] = [
  { type: 'multi-prompt', label: '多行', icon: List },
  { type: 'file-upload', label: '文件', icon: FileUp },
  { type: 'template-combo', label: '模板', icon: Grid3X3 },
]

export function BatchInputSection({ onLoadTasks, disabled, apiKey }: BatchInputSectionProps) {
  const [sourceType, setSourceType] = useState<BatchSourceType>('multi-prompt')

  return (
    <div className="rounded-lg border border-border/50 bg-card p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        任务来源
      </div>

      <div className="flex gap-1 p-1 bg-secondary/50 rounded-md">
        {sources.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            onClick={() => setSourceType(type)}
            disabled={disabled}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-medium transition-all",
              sourceType === type
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {sourceType === 'multi-prompt' && <MultiPromptInput onLoad={onLoadTasks} disabled={disabled} apiKey={apiKey} />}
      {sourceType === 'file-upload' && <FileUploadInput onLoad={onLoadTasks} disabled={disabled} />}
      {sourceType === 'template-combo' && <TemplateInput onLoad={onLoadTasks} disabled={disabled} />}
    </div>
  )
}
