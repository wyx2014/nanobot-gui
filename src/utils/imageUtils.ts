import type { ImageAttachment } from '@/types';

export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function generateAttachmentId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

export function readFileAsBase64(file: File): Promise<{ data: string; mediaType: ImageAttachment['mediaType'] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:image/png;base64," prefix
      const commaIdx = result.indexOf(',');
      const data = commaIdx >= 0 ? result.substring(commaIdx + 1) : result;
      const mediaType = file.type as ImageAttachment['mediaType'];
      resolve({ data, mediaType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
