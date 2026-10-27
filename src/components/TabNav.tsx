import { AppMode } from '@/lib/batch-types'
import { cn } from '@/lib/utils'
import { Type, Image, Film, Layers, Clapperboard } from 'lucide-react'

interface TabNavProps {
  activeMode: AppMode
  onChange: (mode: AppMode) => void
}

const tabs: { mode: AppMode; label: string; icon: typeof Type }[] = [
  { mode: 'text-to-video', label: '文生视频', icon: Type },
  { mode: 'image-to-video', label: '图生视频', icon: Image },
  { mode: 'video-edit', label: '视频编辑', icon: Film },
  { mode: 'batch', label: '批量模式', icon: Layers },
  { mode: 'long-video', label: '长视频', icon: Clapperboard },
]

export function TabNav({ activeMode, onChange }: TabNavProps) {
  return (
    <nav className="flex items-center gap-1 mt-6 p-1 bg-secondary/50 rounded-lg w-fit">
      {tabs.map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
            activeMode === mode
              ? "bg-card text-foreground shadow-sm border-gradient"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </nav>
  )
}
