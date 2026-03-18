import { toast } from 'sonner';

type AlertFunction = (message?: unknown) => void;

let originalAlert: AlertFunction | null = null;

export const notifySuccess = (message: string) => toast.success(message);
export const notifyError = (message: string) => toast.error(message);
export const notifyInfo = (message: string) => toast.message(message);

export const installAlertShim = () => {
  if (typeof window === 'undefined' || originalAlert) {
    return;
  }

  originalAlert = window.alert.bind(window);
  window.alert = ((message?: unknown) => {
    const text =
      typeof message === 'string'
        ? message
        : message instanceof Error
          ? message.message
          : String(message ?? '');
    if (text.trim()) {
      toast.error(text);
    }
  }) as AlertFunction;
};

export const restoreAlertShim = () => {
  if (!originalAlert || typeof window === 'undefined') {
    return;
  }

  window.alert = originalAlert;
  originalAlert = null;
};
