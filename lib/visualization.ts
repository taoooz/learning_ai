import type { Visualization, VisualizationType } from '@/types/course';

const VISUALIZATION_TYPE_MAP: Record<string, VisualizationType> = {
  flow_chart: 'flowchart',
  flowChart: 'flowchart',
  sequence_diagram: 'sequence',
  class_diagram: 'class',
  state_diagram: 'state',
  er_diagram: 'er',
  key_points: 'keyPoints',
  keypoints: 'keyPoints',
};

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function toRows(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell)));
  return rows.length > 0 ? rows : undefined;
}

function normalizeVisualizationType(value: unknown): VisualizationType | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim();
  return VISUALIZATION_TYPE_MAP[normalized] || (normalized as VisualizationType);
}

export function normalizeVisualization(input: unknown): Visualization | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;

  const raw = input as Record<string, unknown>;
  const data = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
    ? raw.data as Record<string, unknown>
    : undefined;

  const type = normalizeVisualizationType(raw.type);
  if (!type) return undefined;

  const normalized: Visualization = { type };

  const title = typeof raw.title === 'string' ? raw.title : typeof data?.title === 'string' ? data.title : undefined;
  if (title) normalized.title = title;

  const mermaidCode =
    typeof raw.mermaidCode === 'string' ? raw.mermaidCode :
    typeof raw.mermaid_code === 'string' ? raw.mermaid_code :
    typeof data?.mermaidCode === 'string' ? data.mermaidCode :
    typeof data?.mermaid_code === 'string' ? data.mermaid_code :
    undefined;
  if (mermaidCode) normalized.mermaidCode = mermaidCode;

  const complex = typeof raw.complex === 'boolean' ? raw.complex : typeof data?.complex === 'boolean' ? data.complex : undefined;
  if (typeof complex === 'boolean') normalized.complex = complex;

  normalized.items = toStringArray(raw.items) || toStringArray(data?.items) || toStringArray(data?.points);
  normalized.columns = toStringArray(raw.columns) || toStringArray(data?.columns);
  normalized.rows = toRows(raw.rows) || toRows(data?.rows);

  const rawEvents = Array.isArray(raw.events) ? raw.events : Array.isArray(data?.events) ? data.events : undefined;
  if (rawEvents) {
    const events = rawEvents
      .filter((event): event is Record<string, unknown> => !!event && typeof event === 'object' && !Array.isArray(event))
      .map((event) => ({
        time: String(event.time ?? ''),
        title: String(event.title ?? ''),
        description: typeof event.description === 'string' ? event.description : undefined,
      }))
      .filter((event) => event.time || event.title);
    if (events.length > 0) normalized.events = events;
  }

  return normalized;
}
