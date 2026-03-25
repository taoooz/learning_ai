'use client';

interface RetryModalProps {
  isOpen: boolean;
  onRetry: () => void;
  onSkip: () => void;
  message?: string;
}

export function RetryModal({ isOpen, onRetry, onSkip, message = '内容生成失败' }: RetryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
      <div className="bg-surface rounded-2xl p-6 max-w-sm w-full mx-4 shadow-float animate-in zoom-in-95 duration-200">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gradient-to-br from-warning/20 to-warning/5 flex items-center justify-center">
          <svg className="w-7 h-7 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-primary text-center mb-2">生成遇到点问题</h2>
        <p className="text-secondary text-sm text-center mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onSkip}
            className="flex-1 px-4 py-3 rounded-xl border border-subtle text-secondary font-medium hover:bg-subtle active:scale-[0.98] transition-all duration-150"
          >
            跳过
          </button>
          <button
            onClick={onRetry}
            className="flex-1 px-4 py-3 rounded-xl bg-accent text-white font-medium hover:shadow-md active:scale-[0.98] transition-all duration-150"
          >
            重试
          </button>
        </div>
      </div>
    </div>
  );
}