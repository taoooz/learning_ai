'use client';

interface ComparisonTableProps {
  title?: string;
  columns: string[];      // ['特性', '方案A', '方案B']
  rows: string[][];       // [['性能', '快', '慢'], ['体积', '小', '大']]
}

export function ComparisonTable({ title, columns, rows }: ComparisonTableProps) {
  return (
    <div className="my-4 overflow-x-auto">
      {title && <h3 className="text-lg font-semibold text-primary mb-2">{title}</h3>}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface border-b border-subtle">
            {columns.map((col, i) => (
              <th key={i} className="px-4 py-2 text-left font-medium text-primary">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-subtle/50 hover:bg-surface/50">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-secondary">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}