import * as AlertDialog from '@radix-ui/react-alert-dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onOpenChange,
  onConfirm
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[81] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[28px] border-4 border-black bg-[#FFFDF5] p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
          <AlertDialog.Title className="text-2xl font-black uppercase tracking-tight text-slate-900">
            {title}
          </AlertDialog.Title>
          {description ? (
            <AlertDialog.Description className="mt-3 text-sm font-semibold text-slate-600">
              {description}
            </AlertDialog.Description>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel className="inline-flex items-center justify-center rounded-xl border-2 border-black bg-white px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-700 transition-colors hover:bg-slate-100">
              {cancelLabel}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={onConfirm}
              className={`inline-flex items-center justify-center rounded-xl border-2 border-black px-4 py-3 text-sm font-black uppercase tracking-wide text-black transition-colors ${
                tone === 'danger' ? 'bg-[#FCA5A5] hover:bg-[#F87171]' : 'bg-[#FDE68A] hover:bg-[#FCD34D]'
              }`}
            >
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
