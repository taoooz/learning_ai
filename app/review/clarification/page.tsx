'use client';

import { useState } from 'react';
import { ClarificationScreen } from '@/components/ClarificationScreen';

const initialQuestions = [
  {
    id: 'q1',
    question: '你更希望这门课程偏理解原理，还是偏实际应用？',
    answer: '',
  },
  {
    id: 'q2',
    question: '你目前对这个主题已经了解到了什么程度？',
    answer: '',
  },
  {
    id: 'q3',
    question: '你最想先解决的具体问题是什么？',
    answer: '',
  },
];

export default function ReviewClarificationPage() {
  const [questions, setQuestions] = useState(initialQuestions);

  const canSubmit = questions.every((item) => item.answer.trim() !== '');

  return (
    <ClarificationScreen
      questions={questions}
      onChange={(id, value) => {
        setQuestions((prev) =>
          prev.map((item) => (item.id === id ? { ...item, answer: value } : item))
        );
      }}
      onSubmit={() => {}}
      onBack={() => window.history.length > 1 ? window.history.back() : (window.location.href = '/')}
      canSubmit={canSubmit}
    />
  );
}
