// components/ui/chat/AssistantGlyph.tsx

export function AssistantGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="assistant-glyph-gradient" x1="10" y1="52" x2="54" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22D3EE" />
          <stop offset="0.52" stopColor="#6F8BFF" />
          <stop offset="1" stopColor="#F3B3D1" />
        </linearGradient>
      </defs>
      <path
        d="M32 6c4.5 0 6.9 8.2 9.7 14.1 1.6 3.5 4.3 6.2 7.8 7.8C55.4 30.7 64 33 64 37.6c0 4.7-8.6 7-14.5 9.7-3.5 1.6-6.2 4.3-7.8 7.8C38.9 61 36.5 64 32 64c-4.5 0-6.9-3-9.7-8.9-1.6-3.5-4.3-6.2-7.8-7.8C8.6 44.6 0 42.3 0 37.6c0-4.6 8.6-6.9 14.5-9.7 3.5-1.6 6.2-4.3 7.8-7.8C25.1 14.2 27.5 6 32 6Z"
        fill="url(#assistant-glyph-gradient)"
      />
      <rect x="21.5" y="27" width="7" height="13" rx="3.5" fill="white" fillOpacity="0.98" />
      <rect x="35.5" y="27" width="7" height="13" rx="3.5" fill="white" fillOpacity="0.98" />
    </svg>
  );
}
