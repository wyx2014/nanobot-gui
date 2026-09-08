import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { recordDiagnostic } from '@/core/diagnostics';
import { diagnosticError } from '@/shared/diagnostics';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        recordDiagnostic({ event_name: 'renderer.render_failed', status: 'failed', level: 'error', details: { ...diagnosticError(error), component_stack: errorInfo.componentStack } });
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-screen bg-[#faf9f5] p-6 text-center">
                    <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-6">
                        <AlertCircle className="w-10 h-10 text-red-500" />
                    </div>
                    <h1 className="text-2xl font-semibold text-[#29261b] mb-2">抱歉，程序出错了</h1>
                    <p className="text-[#656358] max-w-md mb-8">
                        应用遇到了一个意外错误。你可以尝试刷新或重新启动应用。
                    </p>

                    <div className="bg-white border border-[#e5e2db] rounded-xl p-4 mb-8 max-w-2xl w-full text-left overflow-auto max-h-[300px]">
                        <p className="text-sm font-mono text-red-600 break-words">
                            {this.state.error?.toString()}
                        </p>
                        {this.state.error?.stack && (
                            <pre className="text-[10px] text-[#9a9689] mt-3 font-mono leading-relaxed">
                                {this.state.error.stack}
                            </pre>
                        )}
                    </div>

                    <div className="flex gap-4">
                        <Button
                            onClick={() => window.location.reload()}
                            className="bg-[#d97757] hover:bg-[#c86a4d] text-white px-6 py-2 rounded-full flex items-center gap-2"
                        >
                            <RefreshCw className="w-4 h-4" />
                            刷新页面
                        </Button>
                        <Button
                            onClick={() => this.setState({ hasError: false, error: null })}
                            variant="outline"
                            className="border-[#e5e2db] text-[#656358] hover:bg-[#f5f3ee] px-6 py-2 rounded-full"
                        >
                            尝试恢复
                        </Button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
