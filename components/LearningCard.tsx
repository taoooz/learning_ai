'use client';

import ReactMarkdown from 'react-markdown';
import { LearningCard as LearningCardType } from '@/types/course';

interface LearningCardProps {
  card: LearningCardType;
}

export function LearningCard({ card }: LearningCardProps) {
  return (
    <div className="w-full h-full flex flex-col p-6 bg-surface rounded-2xl border border-subtle">
      <h2 className="text-xl font-bold text-primary mb-4">{card.title}</h2>
      <div className="flex-1 text-secondary text-sm leading-relaxed">
        <ReactMarkdown>{card.content}</ReactMarkdown>
      </div>
      {card.imageUrl && (
        <div className="mt-4">
          <img src={card.imageUrl} alt="" className="rounded-lg max-h-40 object-cover" />
        </div>
      )}
    </div>
  );
}