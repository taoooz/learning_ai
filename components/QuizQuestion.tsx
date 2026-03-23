// components/QuizQuestion.tsx
'use client';

import { useState } from 'react';
import { Question } from '@/types/course';
import { ProgressBar } from './ui/ProgressBar';

interface QuizQuestionProps {
  questions: Question[];
  onComplete: () => void;
}

// 从选项中提取答案标识符（如 "A. xxx" -> "A"）
function extractAnswerKey(option: string): string {
  const match = option.match(/^([A-D])[.、：:]\s*/);
  return match ? match[1] : option;
}

// 检查答案是否正确
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
    <div className="w-full max-w-md mx-auto">
      {/* 进度 */}
      <div className="mb-6">
        <ProgressBar current={currentIndex + 1} total={questions.length} />
      </div>

      {/* 题目 */}
      <div className="bg-white rounded-2xl p-6 shadow-lg mb-4">
        <div className="text-sm text-gray-500 mb-2">
          {currentQuestion.type === 'single' && '单选题'}
          {currentQuestion.type === 'multiple' && '多选题'}
          {currentQuestion.type === 'fill' && '填空题'}
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">
          {currentQuestion.question}
        </h2>

        {/* 选项 */}
        {currentQuestion.type !== 'fill' && currentQuestion.options && (
          <div className="space-y-3">
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
                    w-full p-4 rounded-lg border-2 text-left transition-all
                    ${isSelected && !isAnswered ? 'border-blue-500 bg-blue-50' : ''}
                    ${showCorrect ? 'border-green-500 bg-green-50' : ''}
                    ${showIncorrect ? 'border-red-500 bg-red-50' : ''}
                    ${!isAnswered && !isSelected ? 'border-gray-200 hover:border-blue-300' : ''}
                  `}
                >
                  {option}
                </button>
              );
            })}
          </div>
        )}

        {/* 填空题 */}
        {currentQuestion.type === 'fill' && (
          <div>
            <input
              type="text"
              value={fillAnswer}
              onChange={(e) => handleFillChange(e.target.value)}
              disabled={isAnswered}
              className={`
                w-full p-4 rounded-lg border-2
                ${isAnswered && isCorrect ? 'border-green-500 bg-green-50' : ''}
                ${isAnswered && !isCorrect ? 'border-red-500 bg-red-50' : ''}
                ${!isAnswered ? 'border-gray-200 focus:border-blue-500' : ''}
              `}
              placeholder="输入你的答案..."
            />
          </div>
        )}

        {/* 解释（答错后显示） */}
        {isAnswered && !isCorrect && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-red-500">错误！ </span>
              {currentQuestion.explanation}
            </p>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end">
        {!isAnswered ? (
          <button
            onClick={checkAnswer}
            disabled={
              currentQuestion.type === 'fill'
                ? !fillAnswer.trim()
                : selectedAnswer.length === 0
            }
            className="px-6 py-2 rounded-full bg-blue-500 text-white disabled:opacity-40"
          >
            确认答案
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="px-6 py-2 rounded-full bg-blue-500 text-white"
          >
            {isLastQuestion ? '完成课程 →' : '下一题 →'}
          </button>
        )}
      </div>
    </div>
  );
}