import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizeHandleProps {
  position: 'top' | 'left';
  onResize: (delta: number) => void;
  onResizeEnd: () => void;
}

export function ResizeHandle({ position, onResize, onResizeEnd }: ResizeHandleProps): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startPosRef.current = position === 'top' ? e.clientY : e.clientX;
  }, [position]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch === undefined) return;
    setIsDragging(true);
    startPosRef.current = position === 'top' ? touch.clientY : touch.clientX;
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent): void => {
      e.preventDefault();
      const currentPos = position === 'top' ? e.clientY : e.clientX;
      const delta = position === 'top'
        ? startPosRef.current - currentPos
        : startPosRef.current - currentPos;
      startPosRef.current = currentPos;
      onResize(delta);
    };

    const handleTouchMove = (e: TouchEvent): void => {
      const touch = e.touches[0];
      if (touch === undefined) return;
      const currentPos = position === 'top' ? touch.clientY : touch.clientX;
      const delta = position === 'top'
        ? startPosRef.current - currentPos
        : startPosRef.current - currentPos;
      startPosRef.current = currentPos;
      onResize(delta);
    };

    const handleEnd = (): void => {
      setIsDragging(false);
      onResizeEnd();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleEnd);

    return (): void => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, position, onResize, onResizeEnd]);

  if (position === 'top') {
    return (
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="absolute -top-1 left-0 right-0 h-3 cursor-ns-resize group z-10"
      >
        <div className="mx-auto mt-1.5 h-1 w-16 rounded-full bg-slate-600 transition-colors group-hover:bg-amber-500" />
      </div>
    );
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      className="absolute top-0 -left-1 bottom-0 w-3 cursor-ew-resize group z-10"
    >
      <div className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1 h-16 rounded-full bg-slate-600 transition-colors group-hover:bg-amber-500" />
    </div>
  );
}
