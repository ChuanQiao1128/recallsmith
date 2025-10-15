import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import type { ReactNode } from 'react'
export default function Drawer({
  open, onClose, title, children, footer
}:{ open:boolean; onClose:()=>void; title?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <Transition.Child
          enter="ease-out duration-150" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0"
          as={Fragment}
        >
          <div className="fixed inset-0 bg-black/30" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full">
              <Transition.Child
                enter="transform transition ease-in-out duration-200"
                enterFrom="translate-x-full" enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-200"
                leaveFrom="translate-x-0" leaveTo="translate-x-full"
                as={Fragment}
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-3xl">
                  <div className="card h-full flex flex-col">
                    <div className="p-4 border-b flex items-center justify-between">
                      <Dialog.Title className="font-semibold">{title}</Dialog.Title>
                      <button className="btn btn-ghost" onClick={onClose}>Close</button>
                    </div>
                    <div className="flex-1 overflow-auto">{children}</div>
                    {footer && <div className="p-4 border-t flex justify-end gap-2">{footer}</div>}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>

      </Dialog>
    </Transition>
  )
}
