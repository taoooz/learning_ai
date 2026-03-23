'use client';

interface RetryModalProps {
  isOpen: boolean;
  onRetry: () => void;
  onSkip: () => void;
  message?: string;
}

export function RetryModal({ isOpen, onRetry, onSkip, message = 'Failed to generate content' }: RetryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Generation Failed</h2>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onRetry}
            className="flex-1 px-4 py-2 rounded-full border border-gray-300 hover:bg-gray-50"
          >
            Retry
          </button>
          <button
            onClick={onSkip}
            className="flex-1 px-4 py-2 rounded-full bg-gray-900 text-white hover:bg-gray-800"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}