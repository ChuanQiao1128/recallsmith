import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md'

function cn(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ')
}

export default function Button(
  { className, variant='primary', size='md', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
) {
  const base = 'inline-flex items-center justify-center rounded px-3 h-9 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'
  const byVariant: Record<Variant, string> = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-800',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    outline: 'border border-slate-300 text-slate-800 hover:bg-slate-50'
  }
  const bySize: Record<Size, string> = {
    sm: 'h-8 px-2 text-xs',
    md: 'h-9 px-3 text-sm'
  }
  return <button className={cn(base, byVariant[variant], bySize[size], className)} {...rest} />
}
