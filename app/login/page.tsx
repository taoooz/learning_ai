'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useAuth } from '@/hooks/useAuth'
import styles from './page.module.css'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/'
  const { isLoading, isVerified, verifiedCode, verifyInviteCode, register } = useAuth()

  const [inviteCode, setInviteCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 加载中
  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.title}>加载中...</div>
      </div>
    )
  }

  // 已登录，跳转原页面（使用 useEffect 避免 React 警告）
  useEffect(() => {
    if (isVerified && verifiedCode && !error) {
      router.replace(redirect)
    }
  }, [isVerified, verifiedCode, error, redirect, router])

  const handleVerify = async () => {
    if (!inviteCode.trim()) {
      setError('请输入邀请码')
      return
    }

    setError('')
    setIsSubmitting(true)

    const result = await verifyInviteCode(inviteCode.trim())

    if (!result.valid) {
      setError(result.error || '验证失败')
    }

    setIsSubmitting(false)
  }

  const handleRegister = async () => {
    if (!nickname.trim()) {
      setError('请输入昵称')
      return
    }

    setError('')
    setIsSubmitting(true)

    const result = await register(nickname.trim())

    if (result.success) {
      router.replace(redirect)
    } else {
      setError(result.error || '注册失败')
    }

    setIsSubmitting(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') {
      action()
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.logo}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="12" fill="#7c3aed" />
          <path
            d="M24 12L32 20L24 28L16 20L24 12Z"
            fill="white"
          />
          <path
            d="M24 20L32 28L24 36L16 28L24 20Z"
            fill="white"
            fillOpacity="0.6"
          />
        </svg>
      </div>
      <h1 className={styles.title}>AI Learning</h1>
      <p className={styles.subtitle}>让学习更智能</p>

      <div className={styles.form}>
        {!isVerified ? (
          <>
            <input
              type="text"
              className={styles.input}
              placeholder="输入邀请码"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handleVerify)}
              autoComplete="off"
              autoCapitalize="characters"
            />
            <button
              className={styles.button}
              onClick={handleVerify}
              disabled={isSubmitting}
            >
              {isSubmitting ? '验证中...' : '验证'}
            </button>
          </>
        ) : (
          <>
            <div className={styles.successMessage}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm3.72 5.97l-4.47 4.47a.75.75 0 01-1.06 0l-2.22-2.22a.75.75 0 111.06-1.06l1.72 1.72 3.97-3.97a.75.75 0 111.06 1.06h-.06z"/>
              </svg>
              邀请码有效
            </div>
            <input
              type="text"
              className={styles.input}
              placeholder="输入昵称"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handleRegister)}
              autoComplete="nickname"
            />
            <button
              className={styles.button}
              onClick={handleRegister}
              disabled={isSubmitting}
            >
              {isSubmitting ? '登录中...' : '开始学习'}
            </button>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className={styles.container}>
      <div className={styles.title}>加载中...</div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LoginContent />
    </Suspense>
  )
}