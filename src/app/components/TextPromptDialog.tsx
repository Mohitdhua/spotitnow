import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

interface TextPromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: string) => void;
}

export function TextPromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = 'Save',
  onOpenChange,
  onConfirm
}: TextPromptDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
    }
  }, [initialValue, open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[28px] border-4 border-black bg-[#FFFDF5] p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
          <Dialog.Title className="text-2xl font-black uppercase tracking-tight text-slate-900">
            {title}
          </Dialog.Title>
          {description ? <p className="mt-3 text-sm font-semibold text-slate-600">{description}</p> : null}

          <label className="mt-5 block">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
            <input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              className="mt-2 w-full rounded-2xl border-2 border-black bg-white px-4 py-3 text-base font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-[#FDE68A]"
            />
          </label>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center justify-center rounded-xl border-2 border-black bg-white px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-700 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(value)}
              disabled={!value.trim()}
              className="inline-flex items-center justify-center rounded-xl border-2 border-black bg-[#DBEAFE] px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-900 transition-colors hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
