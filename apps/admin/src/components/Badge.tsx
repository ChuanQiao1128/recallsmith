export default function Badge({ children, color='gray' }:{ children: React.ReactNode; color?: 'gray'|'green'|'blue'|'violet'|'rose' }) {
  const map = {
    gray: 'bg-slate-50 text-slate-700 border-slate-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }
  return <span className={`badge ${map[color]}`}>{children}</span>
}
