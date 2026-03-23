'use client';

import { LearningCard as LearningCardType } from '@/types/course';

interface LearningCardProps {
  card: LearningCardType;
}

export function LearningCard({ card }: LearningCardProps) {
  return (
    <div className="w-full h-full flex flex-col p-6 bg-white rounded-2xl shadow-lg">
      <h2 className="text-xl font-bold text-gray-900 mb-4">{card.title}</h2>
      <div className="flex-1 overflow-auto">
        <div className="prose prose-sm max-w-none text-gray-700">
          {card.content}
        </div>
      </div>
      {card.imageUrl && (
        <div className="mt-4">
          <img src={card.imageUrl} alt="" className="rounded-lg max-h-40 object-cover" />
        </div>
      )}
    </div>
  );
}