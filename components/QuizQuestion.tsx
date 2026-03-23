// components/QuizQuestion.tsx
'use client';

import { useState } from 'react';
import { Question } from '@/types/course';
import { ProgressBar } from './ui/ProgressBar';

interface QuizQuestionProps {
  questions: Question[];
  onComplete: () => void;
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
    const answer = currentQuestion.answer;
    let correct = false;

    if (currentQuestion.type === 'fill') {
      correct = fillAnswer.trim().toLowerCase() === String(answer).toLowerCase();
    } else if (Array.isArray(answer)) {
      const selected = new Set(selectedAnswer);
      const correctSet = new Set(answer);
      correct = selected.size === correctSet.size && [...selected].every(a => correctSet.has(a));
    } else {
      correct = selectedAnswer.length === 1 && selectedAnswer[0] === answer;
    }

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
          {currentQuestion.type === 'single' && 'Single Choice'}
          {currentQuestion.type === 'multiple' && 'Multiple Choice'}
          {currentQuestion.type === 'fill' && 'Fill in the Blank'}
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">
          {currentQuestion.question}
        </h2>

        {/* 选项 */}
        {currentQuestion.type !== 'fill' && currentQuestion.options && (
          <div className="space-y-3">
            {currentQuestion.options.map((option, i) => {
              const isSelected = selectedAnswer.includes(option);
              const showCorrect = isAnswered && (Array.isArray(currentQuestion.answer)
                ? currentQuestion.answer.includes(option)
                : currentQuestion.answer === option);
              const showIncorrect = isAnswered && isSelected && !showCorrect;

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
              placeholder="Type your answer..."
            />
          </div>
        )}

        {/* 解释（答错后显示） */}
        {isAnswered && !isCorrect && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-red-500">Incorrect. </span>
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
            Check
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="px-6 py-2 rounded-full bg-blue-500 text-white"
          >
            {isLastQuestion ? 'Complete →' : 'Next →'}
          </button>
        )}
      </div>
    </div>
  );
}