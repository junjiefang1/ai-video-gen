import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-xl border border-destructive/50 bg-destructive/5 space-y-3">
          <h3 className="text-sm font-semibold text-destructive">渲染出错</h3>
          <p className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-xs text-primary hover:underline"
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
