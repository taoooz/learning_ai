// components/StorageWarningToast.tsx
// 全局监听存储写失败事件，向用户展示可见提示（事件源头已做 30s 节流）
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Toast } from './ui/Toast';
import { STORAGE_WRITE_FAILED_EVENT } from '@/lib/storage';

export function StorageWarningToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener(STORAGE_WRITE_FAILED_EVENT, handler);
    return () => window.removeEventListener(STORAGE_WRITE_FAILED_EVENT, handler);
  }, []);

  const handleClose = useCallback(() => setVisible(false), []);

  return (
    <Toast
      message="保存失败：浏览器存储空间不足，请清理后重试"
      type="error"
      isVisible={visible}
      onClose={handleClose}
      duration={6000}
    />
  );
}
