'use client';

import { TimelineEvent } from '@/types/course';

interface TimelineProps {
  title?: string;
  events: TimelineEvent[];
}

export function Timeline({ title, events }: TimelineProps) {
  return (
    <div className="my-4">
      {title && <h3 className="text-lg font-semibold text-primary mb-4">{title}</h3>}
      <div className="relative">
        {/* 时间线竖线 */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
        <div className="space-y-4">
          {events.map((event, i) => (
            <div key={i} className="relative pl-10">
              {/* 时间点圆点 */}
              <div className="absolute left-2.5 w-3 h-3 rounded-full bg-accent border-2 border-background" />
              <div>
                <span className="text-xs font-mono text-accent">{event.time}</span>
                <h4 className="font-medium text-primary">{event.title}</h4>
                {event.description && (
                  <p className="text-sm text-secondary mt-1">{event.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}