// components/QuizQuestion.tsx
'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Question } from '@/types/course';

interface QuizQuestionProps {
  questions: Question[];
  onComplete: () => void;
}

function extractAnswerKey(option: string): string {
  const match = option.match(/^([A-D])[.、：:]\s*/);
  return match ? match[1] : option;
}

function checkIsCorrect(question: Question, selectedAnswer: string[], fillAnswer: string): boolean {
  const answer = question.answer;

  if (question.type === 'fill') {
    return fillAnswer.trim().toLowerCase() === String(answer).toLowerCase();
  }

  if (question.type === 'single') {
    const selected = selectedAnswer[0];
    const selectedKey = extractAnswerKey(selected);
    return selectedKey === answer || selected === answer;
  }

  if (question.type === 'multiple' && Array.isArray(answer)) {
    const selectedKeys = selectedAnswer.map(extractAnswerKey);
    const correctKeys = answer;
    return selectedKeys.length === correctKeys.length &&
      selectedKeys.every(k => correctKeys.includes(k));
  }

  return false;
}

export function QuizQuestion({ questions, onComplete }: QuizQuestionProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string[]>([]);
  const [fillAnswer, setFillAnswer] = useState('');
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;
  const progressPercent = ((currentIndex + 1) / questions.length) * 100;

  const handleSingleSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedAnswer([option]);
  };

  const handleMultiSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedAnswer(prev =>
      prev.includes(option) ? prev.filter(o => o !== option) : [...prev, option]
    );
  };

  const handleFillChange = (value: string) => {
    if (isAnswered) return;
    setFillAnswer(value);
  };

  const checkAnswer = () => {
    const correct = checkIsCorrect(currentQuestion, selectedAnswer, fillAnswer);
    setIsCorrect(correct);
    setIsAnswered(true);
  };

  const handleNext = () => {
    if (isLastQuestion) {
      onComplete();
    } else {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer([]);
      setFillAnswer('');
      setIsAnswered(false);
      setIsCorrect(false);
    }
  };

  return (
    <div className="w-full">
      {/* 进度条 */}
      <div className="mb-5">
        <div className="flex justify-between text-xs text-secondary mb-1.5">
          <span>{currentIndex + 1}/{questions.length}</span>
        </div>
        <div className="w-full bg-subtle rounded-full h-1 overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 题干 */}
      <h2 className="text-base font-medium text-primary mb-4">
        <ReactMarkdown>{currentQuestion.question}</ReactMarkdown>
      </h2>

      {/* 选项 */}
      {currentQuestion.type !== 'fill' && currentQuestion.options && (
        <div className="space-y-2 mb-4">
          {currentQuestion.options.map((option, i) => {
            const isSelected = selectedAnswer.includes(option);
            const correctAnswer = currentQuestion.type === 'single'
              ? currentQuestion.answer
              : Array.isArray(currentQuestion.answer)
                ? currentQuestion.answer
                : [];
            const isCorrectOption = Array.isArray(correctAnswer)
              ? correctAnswer.includes(extractAnswerKey(option))
              : extractAnswerKey(option) === correctAnswer;
            const showCorrect = isAnswered && isCorrectOption;
            const showIncorrect = isAnswered && isSelected && !isCorrectOption;

            return (
              <button
                key={i}
                onClick={() => currentQuestion.type === 'single' ? handleSingleSelect(option) : handleMultiSelect(option)}
                disabled={isAnswered}
                className={`
                  w-full p-3 rounded-xl border text-left text-sm transition-all
                  ${isSelected && !isAnswered ? 'border-accent bg-accent/5' : ''}
                  ${showCorrect ? 'border-success bg-success/5' : ''}
                  ${showIncorrect ? 'border-error bg-error/5' : ''}
                  ${!isAnswered && !isSelected ? 'border-subtle hover:border-accent/30' : ''}
                `}
              >
                <ReactMarkdown>{option}</ReactMarkdown>
              </button>
            );
          })}
        </div>
      )}

      {/* 填空题 */}
      {currentQuestion.type === 'fill' && (
        <div className="mb-4">
          <input
            type="text"
            value={fillAnswer}
            onChange={(e) => handleFillChange(e.target.value)}
            disabled={isAnswered}
            className={`
              w-full p-3 rounded-xl border text-sm
              ${isAnswered && isCorrect ? 'border-success bg-success/5' : ''}
              ${isAnswered && !isCorrect ? 'border-error bg-error/5' : ''}
              ${!isAnswered ? 'border-subtle focus:border-accent' : ''}
            `}
            placeholder="输入你的答案..."
          />
        </div>
      )}

      {/* 解释 */}
      {isAnswered && !isCorrect && (
        <div className="mb-4 p-3 bg-error/5 rounded-xl text-sm text-secondary">
          <ReactMarkdown>{currentQuestion.explanation}</ReactMarkdown>
        </div>
      )}

      {/* 按钮 */}
      <div className="flex justify-end">
        {!isAnswered ? (
          <button
            onClick={checkAnswer}
            disabled={
              currentQuestion.type === 'fill'
                ? !fillAnswer.trim()
                : selectedAnswer.length === 0
            }
            className="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
          >
            确认
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium active:scale-95 transition-all"
          >
            {isLastQuestion ? '完成探索 →' : '下一题 →'}
          </button>
        )}
      </div>
    </div>
  );
}