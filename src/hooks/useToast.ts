import { useCallback, useEffect, useState } from "react";

export type ToastState = {
  kind: "success" | "error" | "info";
  message: string;
} | null;

export type ShowToast = (kind: NonNullable<ToastState>["kind"], message: string) => void;

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 1800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const showToast = useCallback<ShowToast>((kind, message) => {
    setToast({ kind, message });
  }, []);

  return { toast, showToast };
}
