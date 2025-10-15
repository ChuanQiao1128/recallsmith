import { Dialog as HDialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import type { ReactNode } from 'react'
export default function Dialog({open, onClose, title, children, footer}:{open:boolean; onClose:()=>void; title?:ReactNode; children?:ReactNode; footer?:ReactNode}) {
  return (
    <Transition show={open} as={Fragment}>
      <HDialog onClose={onClose} className="relative z-50">
        <Transition.Child
          enter="ease-out duration-150" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0"
          as={Fragment}
        >
          <div className="fixed inset-0 bg-black/30"/>
        </Transition.Child>
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            as={Fragment}
          >
            <HDialog.Panel className="card w-full max-w-lg">
              <div className="p-4 border-b font-semibold">{title}</div>
              <div className="p-4">{children}</div>
              {footer && <div className="p-4 border-t flex justify-end gap-2">{footer}</div>}
            </HDialog.Panel>
          </Transition.Child>
        </div>
      </HDialog>
    </Transition>
  )
}
