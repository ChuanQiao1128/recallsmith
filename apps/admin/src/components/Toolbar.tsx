import type { ReactNode } from 'react'

export default function Toolbar({ children }: { children?: ReactNode }) {
  return <div className="mb-3 flex items-center gap-2">{children}</div>
}
