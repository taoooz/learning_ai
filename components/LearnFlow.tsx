// components/LearnFlow.tsx
'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { LearningCard as LearningCardType, Question } from '@/types/course';
import { ProgressBar } from './ui/ProgressBar';

interface LearnFlowProps {
  cards: LearningCardType[];
  questions: Question[];
  onComplete: () => void;
}

type Phase = 'learn' | 'quiz' | 'complete';

export function LearnFlow({ cards, questions, onComplete }: LearnFlowProps) {
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('learn');
  const [quizIndex, setQuizIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string[]>([]);
  const [fillAnswer, setFillAnswer] = useState('');
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [learnProgress, setLearnProgress] = useState(0); // 0-2 表示学了几张卡

  const currentCard = cards[currentCardIndex];
  const currentQuestion = questions[quizIndex];
  const isLastCard = currentCardIndex === cards.length - 1;
  const isLastQuestion = quizIndex === questions.length - 1;

  // 提取答案标识符
  const extractAnswerKey = (option: string): string => {
    const match = option.match(/^([A-D])[.、：:]\s*/);
    return match ? match[1] : option;
  };

  // 检查答案是否正确
  const checkAnswer = useCallback(() => {
    const answer = currentQuestion.answer;
    if (currentQuestion.type === 'fill') {
      return fillAnswer.trim().toLowerCase() === String(answer).toLowerCase();
    }
    if (currentQuestion.type === 'single') {
      const selectedKey = extractAnswerKey(selectedAnswer[0]);
      return selectedKey === answer || selectedAnswer[0] === answer;
    }
    if (currentQuestion.type === 'multiple' && Array.isArray(answer)) {
      const selectedKeys = selectedAnswer.map(extractAnswerKey);
      return selectedKeys.length === answer.length && selectedKeys.every(k => answer.includes(k));
    }
    return false;
  }, [currentQuestion, selectedAnswer, fillAnswer]);

  const handleNextLearn = () => {
    if (learnProgress < 1) {
      // 还没学够2张，继续学
      setLearnProgress(prev => prev + 1);
    } else if (learnProgress === 1 && !isLastCard) {
      // 学完2张了，如果有测验就进入测验
      if (questions.length > 0) {
        setLearnProgress(2);
        setPhase('quiz');
        setQuizIndex(0);
        setSelectedAnswer([]);
        setFillAnswer('');
        setIsAnswered(false);
      } else {
        // 没有测验，直接下一张
        setCurrentCardIndex(prev => prev + 1);
        setLearnProgress(0);
      }
    } else {
      // 学够了2张或已经是最后一张，进入下一张
      setCurrentCardIndex(prev => prev + 1);
      setLearnProgress(0);
    }
  };

  const handleAnswerSelect = (option: string) => {
    if (isAnswered) return;
    if (currentQuestion.type === 'single') {
      setSelectedAnswer([option]);
    } else {
      setSelectedAnswer(prev =>
        prev.includes(option) ? prev.filter(o => o !== option) : [...prev, option]
      );
    }
  };

  const handleCheckAnswer = () => {
    const correct = checkAnswer();
    setIsCorrect(correct);
    setIsAnswered(true);
  };

  const handleNextQuestion = () => {
    if (isLastQuestion) {
      setPhase('complete');
      onComplete();
    } else {
      setQuizIndex(prev => prev + 1);
      setSelectedAnswer([]);
      setFillAnswer('');
      setIsAnswered(false);
      setIsCorrect(false);
    }
  };

  const handleSkipQuiz = () => {
    // 跳过测验，继续学下一张
    setCurrentCardIndex(prev => prev + 1);
    setLearnProgress(0);
    setPhase('learn');
  };

  // 完成页面
  if (phase === 'complete') {
    return (
      <div className="w-full max-w-md mx-auto flex flex-col items-center justify-center min-h-[70vh]">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 rounded-full bg-accent/10 flex items-center justify-center mb-6"
        >
          <svg className="w-12 h-12 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </motion.div>
        <h2 className="text-2xl font-semibold text-primary mb-3">太棒了，完成啦！</h2>
        <p className="text-secondary">正在保存进度...</p>
      </div>
    );
  }

  // 学习阶段
  if (phase === 'learn') {
    const showQuizPrompt = learnProgress >= 1 && questions.length > 0 && !isLastCard;
    const progressText = `第 ${currentCardIndex + 1}/${cards.length} 张`;

    return (
      <div className="w-full max-w-md mx-auto">
        {/* 进度 */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-secondary mb-2">
            <span>{progressText}</span>
          </div>
          <ProgressBar current={currentCardIndex + 1} total={cards.length} />
        </div>

        {/* 内容 */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentCardIndex}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="mb-6"
          >
            <h2 className="text-xl font-semibold text-primary mb-4">{currentCard.title}</h2>
            <div className="prose prose-sm max-w-none text-secondary leading-relaxed">
              <ReactMarkdown>{currentCard.content}</ReactMarkdown>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* 底部操作 */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-secondary">
            {showQuizPrompt && '小测验即将开始'}
          </span>
          <div className="flex gap-3">
            {showQuizPrompt ? (
              <>
                <button
                  onClick={handleSkipQuiz}
                  className="px-5 py-2.5 rounded-pill border border-subtle text-secondary hover:border-primary hover:text-primary transition-colors"
                >
                  跳过测验
                </button>
                <button
                  onClick={handleNextLearn}
                  className="px-5 py-2.5 rounded-pill bg-cta text-white hover:bg-cta/90 transition-colors"
                >
                  开始测验 →
                </button>
              </>
            ) : isLastCard ? (
              <button
                onClick={() => {
                  if (questions.length > 0) {
                    setPhase('quiz');
                    setQuizIndex(0);
                  } else {
                    setPhase('complete');
                    onComplete();
                  }
                }}
                className="px-5 py-2.5 rounded-pill bg-cta text-white hover:bg-cta/90 transition-colors"
              >
                {questions.length > 0 ? '开始测验 →' : '完成学习'}
              </button>
            ) : (
              <button
                onClick={handleNextLearn}
                className="px-5 py-2.5 rounded-pill bg-cta text-white hover:bg-cta/90 transition-colors"
              >
                {learnProgress === 0 ? '继续' : '下一张 →'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 测验阶段
  return (
    <div className="w-full max-w-md mx-auto">
      {/* 进度 */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-secondary mb-2">
          <span>测验</span>
          <span>第 {quizIndex + 1}/{questions.length} 题</span>
        </div>
        <ProgressBar current={quizIndex + 1} total={questions.length} />
      </div>

      {/* 题目 */}
      <div className="bg-surface rounded-lg p-6 mb-4">
        <div className="text-sm text-secondary mb-2">
          {currentQuestion.type === 'single' && '单选题'}
          {currentQuestion.type === 'multiple' && '多选题'}
          {currentQuestion.type === 'fill' && '填空题'}
        </div>
        <h2 className="text-xl font-semibold text-primary mb-6">
          <ReactMarkdown>{currentQuestion.question}</ReactMarkdown>
        </h2>

        {/* 选项 */}
        {currentQuestion.type !== 'fill' && currentQuestion.options && (
          <div className="space-y-3">
            {currentQuestion.options.map((option, i) => {
              const isSelected = selectedAnswer.includes(option);
              const correctAnswer = currentQuestion.type === 'single'
                ? currentQuestion.answer
                : Array.isArray(currentQuestion.answer) ? currentQuestion.answer : [];
              const isCorrectOption = Array.isArray(correctAnswer)
                ? correctAnswer.includes(extractAnswerKey(option))
                : extractAnswerKey(option) === correctAnswer;
              const showCorrect = isAnswered && isCorrectOption;
              const showIncorrect = isAnswered && isSelected && !isCorrectOption;

              return (
                <button
                  key={i}
                  onClick={() => handleAnswerSelect(option)}
                  disabled={isAnswered}
                  className={`
                    w-full p-4 rounded-lg border-2 text-left transition-all
                    ${isSelected && !isAnswered ? 'border-primary bg-primary/5' : ''}
                    ${showCorrect ? 'border-success bg-success/10' : ''}
                    ${showIncorrect ? 'border-error bg-error/10' : ''}
                    ${!isAnswered && !isSelected ? 'border-subtle hover:border-primary/50' : ''}
                  `}
                >
                  <ReactMarkdown>{option}</ReactMarkdown>
                </button>
              );
            })}
          </div>
        )}

        {/* 填空 */}
        {currentQuestion.type === 'fill' && (
          <div>
            <input
              type="text"
              value={fillAnswer}
              onChange={(e) => setFillAnswer(e.target.value)}
              disabled={isAnswered}
              className={`
                w-full p-4 rounded-lg border-2
                ${isAnswered && isCorrect ? 'border-success bg-success/10' : ''}
                ${isAnswered && !isCorrect ? 'border-error bg-error/10' : ''}
                ${!isAnswered ? 'border-subtle focus:border-primary' : ''}
              `}
              placeholder="输入你的答案..."
            />
          </div>
        )}

        {/* 解释 */}
        {isAnswered && !isCorrect && (
          <div className="mt-4 p-4 bg-error/5 rounded-lg">
            <p className="text-sm text-secondary">
              <span className="font-medium text-error">错误！ </span>
              <ReactMarkdown>{currentQuestion.explanation}</ReactMarkdown>
            </p>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex justify-end">
        {!isAnswered ? (
          <button
            onClick={handleCheckAnswer}
            disabled={
              currentQuestion.type === 'fill'
                ? !fillAnswer.trim()
                : selectedAnswer.length === 0
            }
            className="px-6 py-2.5 rounded-pill bg-cta text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cta/90 transition-colors"
          >
            确认答案
          </button>
        ) : (
          <button
            onClick={handleNextQuestion}
            className="px-6 py-2.5 rounded-pill bg-cta text-white hover:bg-cta/90 transition-colors"
          >
            {isLastQuestion ? '完成课程' : '下一题 →'}
          </button>
        )}
      </div>
    </div>
  );
}