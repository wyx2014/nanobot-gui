import { useEffect, useState, useCallback } from 'react';
import { isLocalFilePath } from '@/utils/pathUtils';

export function resolveDroppedFilePath(file: File): string | null {
  let supportedPath = '';
  try {
    supportedPath = window.api?.getPathForFile?.(file) ?? '';
  } catch {
    // Keep the legacy property as a compatibility fallback for older Electron
    // builds and isolated browser tests.
  }

  const legacyPath = (file as File & { path?: string }).path ?? '';
  const candidate = supportedPath.trim() || legacyPath.trim();
  return candidate && isLocalFilePath(candidate) ? candidate : null;
}

export function useFileDragDrop(
  onDrop: (paths: string[], unresolvedNames: string[]) => void,
) {
  const [isDragging, setIsDragging] = useState(false);

  const stableDrop = useCallback(
    (paths: string[], unresolvedNames: string[]) => onDrop(paths, unresolvedNames),
    [onDrop],
  );

  useEffect(() => {
    let dragCounter = 0;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter === 0) {
        setIsDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      setIsDragging(false);

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const paths: string[] = [];
        const unresolvedNames: string[] = [];
        Array.from(e.dataTransfer.files).forEach((file) => {
          const path = resolveDroppedFilePath(file);
          if (path) paths.push(path);
          else unresolvedNames.push(file.name);
        });
        stableDrop(paths, unresolvedNames);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [stableDrop]);

  return { isDragging };
}
