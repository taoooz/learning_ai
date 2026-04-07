'use client';

interface ComparisonTableProps {
  title?: string;
  columns: string[];      // ['特性', '方案A', '方案B']
  rows: string[][];       // [['性能', '快', '慢'], ['体积', '小', '大']]
}

export function ComparisonTable({ title, columns, rows }: ComparisonTableProps) {
  return (
    <div className="my-6 bg-surface rounded-lg border border-subtle/50">
      {title && <h3 className="text-base font-semibold text-primary px-4 pt-4 pb-2">{title}</h3>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="bg-subtle border-b border-subtle">
              {columns.map((col, i) => (
                <th key={i} className="px-4 py-3 text-left font-semibold text-primary first:rounded-tl-lg last:rounded-tr-lg whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-subtle/30 last:border-0 hover:bg-subtle/30 transition-colors">
                {row.map((cell, j) => (
                  <td key={j} className={`px-4 py-3 ${j === 0 ? 'font-medium text-primary' : 'text-secondary'}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}