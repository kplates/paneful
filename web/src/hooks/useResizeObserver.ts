import { useEffect, useRef } from 'react';
import { RESIZE_DEBOUNCE_MS } from '../lib/constants';

export function useResizeObserver(
  ref: React.RefObject<HTMLElement | null>,
  callback: () => void
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(callback, RESIZE_DEBOUNCE_MS);
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timeoutRef.current);
    };
  }, [ref, callback]);
}
