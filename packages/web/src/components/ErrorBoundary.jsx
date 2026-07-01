import React from 'react'
import Button from './shared/Button.jsx'
import Card from './shared/Card.jsx'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-6 py-12">
          <Card className="max-w-md text-center space-y-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--error)]/10">
              <svg className="h-6 w-6 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-[var(--txt-primary)]">Something went wrong</h2>
              <p className="text-sm text-[var(--txt-secondary)] leading-relaxed">
                An unexpected error occurred in the application. You can try reloading the app or returning to the home page.
              </p>
              {this.state.error?.message && (
                <div className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-left">
                  <p className="font-mono text-xs text-[var(--error)] break-all">{this.state.error.message}</p>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => window.location.reload()} className="flex-1 py-2 text-xs font-semibold uppercase tracking-wider">
                Reload Page
              </Button>
              <Button variant="primary" onClick={this.handleReset} className="flex-1 py-2 text-xs font-semibold uppercase tracking-wider">
                Reset App
              </Button>
            </div>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
