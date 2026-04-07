'use client';

import { TimelineEvent } from '@/types/course';

interface TimelineProps {
  title?: string;
  events: TimelineEvent[];
}

export function Timeline({ title, events }: TimelineProps) {
  return (
    <div className="my-6 p-3 sm:p-4 bg-subtle/30 rounded-lg">
      {title && <h3 className="text-base font-semibold text-primary mb-4">{title}</h3>}
      <div className="relative">
        {/* 时间线竖线 */}
        <div className="absolute left-3 sm:left-4 top-2 bottom-2 w-0.5 bg-accent/20" />
        <div className="space-y-5">
          {events.map((event, i) => (
            <div key={i} className="relative pl-8 sm:pl-10">
              {/* 时间点圆点 */}
              <div className="absolute left-1.5 sm:left-2.5 top-1 w-3 h-3 rounded-full bg-accent border-2 border-background shadow-sm" />
              <div>
                <span className="inline-block text-xs font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded mb-1">{event.time}</span>
                <h4 className="font-semibold text-primary text-sm">{event.title}</h4>
                {event.description && (
                  <p className="text-sm text-secondary mt-1 leading-relaxed">{event.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}