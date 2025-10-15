import type { ReactNode } from 'react'

export type Column<T> = { header: string; className?: string; render: (row: T, idx: number) => ReactNode }

export default function Table<T>({ columns, data, rowKey }:{
  columns: Column<T>[]; data: T[]; rowKey?: (row:T, idx:number)=>string
}) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-50 border-b">
          <tr className="text-muted text-xs uppercase">
            {columns.map((c,i)=>(
              <th key={i} className={`px-3 h-10 text-left ${c.className??''}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={rowKey ? rowKey(r,i) : i} className="border-b hover:bg-slate-50">
              {columns.map((c, j)=>(
                <td key={j} className={`px-3 h-12 align-top ${c.className??''}`}>{c.render(r, i)}</td>
              ))}
            </tr>
          ))}
          {data.length===0 && (
            <tr><td className="px-3 py-10 text-center text-muted" colSpan={columns.length}>No data</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
