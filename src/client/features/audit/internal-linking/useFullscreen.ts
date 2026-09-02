import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Native fullscreen for one element. The graph is the one view here that
 * genuinely needs the whole screen — a few hundred pages in a 560px box is a
 * hairball whatever the layout does.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    // Esc and the browser's own controls exit without going through toggle().
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [ref]);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    // Rejects when the browser blocks it (no user gesture, iframe policy);
    // the view simply stays as it is.
    void ref.current?.requestFullscreen().catch(() => setIsFullscreen(false));
  }, [ref]);

  return { isFullscreen, toggle };
}
