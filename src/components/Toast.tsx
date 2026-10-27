import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

interface ToastProps {
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void
}

export function Toast({ message, type, onClose }: ToastProps) {
  const icons = {
    success: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    error: <XCircle className="h-4 w-4 text-destructive" />,
    info: <Info className="h-4 w-4 text-primary" />,
  }

  return (
    <div className="fixed top-4 right-4 z-[200] animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card shadow-lg max-w-sm">
        {icons[type]}
        <p className="text-sm text-foreground flex-1">{message}</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
