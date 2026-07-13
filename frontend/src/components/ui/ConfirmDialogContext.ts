import { createContext } from 'react';

export interface ConfirmOptions {
  title: string;
  body?: string;
  destructive?: boolean;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);
