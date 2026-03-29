'use client';

import { useState, useRef, useEffect } from 'react';
import type { CourseBlueprint, ClarificationQuestion, CourseBlueprintNode } from '@/types/course';
import { ChatMessage } from './ui/ChatMessage';
import { ConfirmationCard } from './ConfirmationCard';

interface ClarificationScreenProps {
  topic: string;
  initialMessages: ChatMessageData[];
  questions?: ClarificationQuestion[];
  blueprint?: CourseBlueprint;
  onConfirm: (blueprint: CourseBlueprint) => void;
  onSendMessage: (message: string) => Promise<void>;
}

interface EditState {
  courseGoal: string;
  difficultySummary: string;
  whyThisCourseFits: string;
  nodes: { title: string; teachingGoal: string }[];
}

export interface ChatMessageData {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function ClarificationScreen({ topic, initialMessages, questions, blueprint, onConfirm, onSendMessage }: ClarificationScreenProps) {
  const [messages, setMessages] = useState<ChatMessageData[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    setError(null);
    const userMessage = { role: 'user' as const, content: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      await onSendMessage(input);
    } catch (err) {
      setError('发送失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (blueprint) onConfirm(blueprint);
  };

  const handleEdit = () => {
    if (!blueprint) return;
    setEditState({
      courseGoal: blueprint.courseGoal,
      difficultySummary: blueprint.learnerPositioning?.difficultySummary || '',
      whyThisCourseFits: blueprint.learnerPositioning?.whyThisCourseFits || '',
      nodes: blueprint.nodes.map(n => ({ title: n.title, teachingGoal: n.teachingGoal })),
    });
    setIsEditing(true);
  };

  const handleEditSave = () => {
    if (!blueprint || !editState) return;
    const updatedBlueprint: CourseBlueprint = {
      ...blueprint,
      courseGoal: editState.courseGoal,
      learnerPositioning: {
        ...blueprint.learnerPositioning,
        difficultySummary: editState.difficultySummary,
        whyThisCourseFits: editState.whyThisCourseFits,
      },
      nodes: blueprint.nodes.map((n, i) => ({
        ...n,
        title: editState.nodes[i]?.title || n.title,
        teachingGoal: editState.nodes[i]?.teachingGoal || n.teachingGoal,
      })),
    };
    onConfirm(updatedBlueprint);
    setIsEditing(false);
    setEditState(null);
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditState(null);
  };

  const handleRetry = () => {
    setError(null);
    handleSend();
  };

  // 编辑模式
  if (isEditing && editState) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <h2 className="text-lg font-semibold">编辑课程大纲</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">学习目标</label>
              <textarea
                value={editState.courseGoal}
                onChange={(e) => setEditState(prev => prev ? { ...prev, courseGoal: e.target.value } : null)}
                className="w-full rounded-lg border px-3 py-2 h-20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">难度评估</label>
              <input
                type="text"
                value={editState.difficultySummary}
                onChange={(e) => setEditState(prev => prev ? { ...prev, difficultySummary: e.target.value } : null)}
                className="w-full rounded-lg border px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">为什么适合你</label>
              <textarea
                value={editState.whyThisCourseFits}
                onChange={(e) => setEditState(prev => prev ? { ...prev, whyThisCourseFits: e.target.value } : null)}
                className="w-full rounded-lg border px-3 py-2 h-20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">章节结构</label>
              <div className="space-y-3">
                {editState.nodes.map((node, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="font-medium">章节 {i + 1}</div>
                    <input
                      type="text"
                      value={node.title}
                      onChange={(e) => setEditState(prev => {
                        if (!prev) return null;
                        const nodes = [...prev.nodes];
                        nodes[i] = { ...nodes[i], title: e.target.value };
                        return { ...prev, nodes };
                      })}
                      placeholder="章节标题"
                      className="w-full rounded-lg border px-3 py-2"
                    />
                    <textarea
                      value={node.teachingGoal}
                      onChange={(e) => setEditState(prev => {
                        if (!prev) return null;
                        const nodes = [...prev.nodes];
                        nodes[i] = { ...nodes[i], teachingGoal: e.target.value };
                        return { ...prev, nodes };
                      })}
                      placeholder="教学目标"
                      className="w-full rounded-lg border px-3 py-2 h-16"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t p-4 flex gap-2">
          <button onClick={handleEditCancel} className="flex-1 px-4 py-2 border rounded-lg">
            取消
          </button>
          <button onClick={handleEditSave} className="flex-1 px-4 py-2 bg-primary text-white rounded-lg">
            保存并继续
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={{ id: String(i), ...msg }} />
        ))}
        {isLoading && <div className="animate-pulse">AI 思考中...</div>}
        {error && (
          <div className="bg-error/10 border border-error/30 rounded-lg p-3 text-error text-sm">
            <div className="flex items-center justify-between">
              <span>{error}</span>
              <button onClick={handleRetry} className="underline hover:no-underline">
                重试
              </button>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {!questions?.length && blueprint && (
        <ConfirmationCard blueprint={blueprint} onConfirm={handleConfirm} onEdit={handleEdit} />
      )}

      <div className="border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="补充信息或回答问题..."
            className="flex-1 rounded-lg border px-4 py-2"
          />
          <button onClick={handleSend} disabled={isLoading} className="px-4 py-2 bg-primary text-white rounded-lg">
            发送
          </button>
        </div>
      </div>
    </div>
  );
}