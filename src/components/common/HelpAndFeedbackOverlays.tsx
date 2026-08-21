import { useState } from 'react';
import { Check, ImagePlus, Loader2, X } from 'lucide-react';

import HelpManual from '@/components/settings/HelpManual';
import { submitPromptHubFeedback } from '@/core/prompthubApi';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { usePromptHubStore } from '@/stores/promptHubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/** Global overlays so title-bar Help actions do not require SettingsView to mount. */
export default function HelpAndFeedbackOverlays() {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
  const helpManualOpen = useSettingsStore((state) => state.helpManualOpen);
  const closeHelpManual = useSettingsStore((state) => state.closeHelpManual);
  const feedbackDialogOpen = useSettingsStore((state) => state.feedbackDialogOpen);
  const closeFeedbackDialog = useSettingsStore((state) => state.closeFeedbackDialog);
  const promptHubUser = usePromptHubStore((state) => state.user);
  const promptHubBaseUrl = usePromptHubStore((state) => state.baseUrl);
  const addToast = useToastStore((state) => state.addToast);
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [saving, setSaving] = useState(false);

  const closeFeedback = () => {
    closeFeedbackDialog();
    setText('');
    setImages([]);
  };

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const next = [...images];
    for (const file of Array.from(files)) {
      if (next.length >= 4) break;
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 2 * 1024 * 1024) {
        addToast({ type: 'error', title: isEnglish ? 'Image too large' : '图片过大', message: isEnglish ? 'Each image must be 2 MB or smaller.' : '单张图片不能超过 2MB' });
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      next.push(dataUrl);
    }
    setImages(next);
  };

  const submit = async () => {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      await submitPromptHubFeedback(promptHubBaseUrl, {
        username: promptHubUser?.username,
        content,
        images,
        includeLogs,
        platform: navigator.platform,
      });
      closeFeedback();
      addToast({ type: 'success', title: isEnglish ? 'Feedback submitted' : '反馈已提交' });
    } catch (error) {
      addToast({ type: 'error', title: isEnglish ? 'Submission failed' : '操作失败', message: error instanceof Error ? error.message : String(error), duration: 5000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {helpManualOpen ? <HelpManual onClose={closeHelpManual} /> : null}
      {feedbackDialogOpen ? (
        <div className="window-modal-viewport fixed inset-0 z-[100] flex items-center justify-center bg-black/15 p-6" onMouseDown={(event) => event.target === event.currentTarget && closeFeedback()}>
          <section role="dialog" aria-modal="true" aria-label={isEnglish ? 'Send Feedback' : '意见反馈'} className="w-[min(480px,calc(100vw-48px))] overflow-hidden rounded-xl border border-black/5 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-[#eeeeef] px-5 py-4">
              <h3 className="text-lg font-semibold text-[#202020]">{isEnglish ? 'Send Feedback' : '意见反馈'}</h3>
              <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-[#777] hover:bg-[#f2f2f3]" onClick={closeFeedback}><X className="h-5 w-5" /></button>
            </div>
            <div className="px-5 py-6">
              <div className="rounded-xl border border-[#e2e2e4] bg-white p-3">
                <Textarea value={text} onChange={(event) => setText(event.target.value.slice(0, 300))} placeholder={isEnglish ? 'Describe the issue you encountered' : '你可以描述你遇到的问题'} className="min-h-[210px] resize-none border-0 bg-white p-0 text-base shadow-none focus-visible:ring-0" />
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#e2e2e4] bg-[#fafafa] px-3 py-2 text-sm text-[#666] hover:bg-[#f4f4f5]"><ImagePlus className="h-4 w-4" />{isEnglish ? `Upload images (${images.length}/4)` : `上传图片 (${images.length}/4)`}<input type="file" accept="image/*" multiple className="hidden" onChange={(event) => { void addImages(event.target.files); event.currentTarget.value = ''; }} disabled={images.length >= 4} /></label>
                    {images.length ? <button type="button" className="text-xs text-[#888] hover:text-[#202020]" onClick={() => setImages([])}>{isEnglish ? 'Clear' : '清空'}</button> : null}
                  </div>
                  <span className="text-sm text-[#8a8a8d]">{text.length}/300</span>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-4">
                <button type="button" className="flex min-w-0 items-start gap-3 text-left" onClick={() => setIncludeLogs(!includeLogs)}><span className={cn('mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-md', includeLogs ? 'bg-[#202020] text-white' : 'border border-[#d6d6d8]')}>{includeLogs ? <Check className="h-4 w-4" /> : null}</span><span className="text-sm leading-6 text-[#5f6368]">{isEnglish ? 'Include logs for troubleshooting. They may contain conversations and device information.' : '上传日志，仅用于排查问题，可能包含对话记录、设备信息等数据。'}</span></button>
                <Button className="h-12 shrink-0 rounded-full bg-[#202020] px-8 text-base font-semibold text-white hover:bg-[#333] disabled:bg-[#d8d8d8]" disabled={saving || !text.trim()} onClick={() => void submit()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{isEnglish ? 'Submit' : '提交'}</Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
