import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, FilePenLine, Loader2, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useOfficeGuideStore, type OfficeGuideStep } from '@/stores/officeGuideStore';
import { OFFICE_WRITING_EXAMPLES, OFFICE_WRITING_SKILL_NAME } from '@/components/chat/workspaceTaskShortcuts';
import { Button } from '@/components/ui/button';
import { placeOfficeGuide, type GuideRect } from './officeGuideLayout';
import './officeTaskGuide.css';

const TARGETS: Record<OfficeGuideStep, string[]> = {
  welcome: [],
  category: ['[data-welcome-shortcut="office"]'],
  task: ['[data-welcome-shortcut-option="draft_material"]'],
  workspace: ['[data-welcome-project-selector]'],
  skills: [`[data-selected-skill="${OFFICE_WRITING_SKILL_NAME}"]`, '[data-selected-skill="image-extract"]'],
  compose: ['[data-welcome-composer-input]'],
};

const STEPS: OfficeGuideStep[] = ['category', 'task', 'workspace', 'skills', 'compose'];

function guideViewport() {
  const titlebarTop = Math.max(0, Math.min(
    window.innerHeight,
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--window-titlebar-safe-top')) || 0,
  ));
  return { titlebarTop, width: window.innerWidth, height: window.innerHeight - titlebarTop };
}

interface OfficeTaskGuideProps {
  activeCategory: string | null;
  preparing: boolean;
  disabled: boolean;
  needsModel: boolean;
  onStart: () => void;
  onSelectCategory: () => void;
  onSelectTask: () => void;
  onEdit: () => void;
  onConfigureModel: () => void;
  onUseExample: (example: typeof OFFICE_WRITING_EXAMPLES[number]) => void;
}

export default function OfficeTaskGuide({
  activeCategory, preparing, disabled, needsModel,
  onStart, onSelectCategory, onSelectTask, onEdit, onConfigureModel, onUseExample,
}: OfficeTaskGuideProps) {
  const { locale } = useI18n();
  const isEn = locale === 'en-US';
  const storedStep = useOfficeGuideStore((state) => state.step);
  const error = useOfficeGuideStore((state) => state.error);
  const advance = useOfficeGuideStore((state) => state.advance);
  const close = useOfficeGuideStore((state) => state.close);
  // Returning from another view may have closed the shortcut menu.
  const step = storedStep === 'task' && activeCategory !== 'office' ? 'category' : storedStep ?? 'welcome';
  const selectors = TARGETS[step];
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => ({
    target: null as GuideRect | null,
    ...placeOfficeGuide(null, guideViewport(), 280),
  }));

  useLayoutEffect(() => {
    let frame = 0;
    const targets = () => selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]);
    const measure = () => {
      const { titlebarTop, ...viewport } = guideViewport();
      const rects = targets().map((node) => node.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
      let target: GuideRect | null = null;
      if (rects.length) {
        const left = Math.max(0, Math.min(...rects.map((rect) => rect.left)) - 6);
        const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - titlebarTop - 6);
        const right = Math.min(viewport.width, Math.max(...rects.map((rect) => rect.right)) + 6);
        const bottom = Math.min(
          viewport.height,
          Math.max(...rects.map((rect) => rect.bottom)) - titlebarTop + 6,
        );
        if (right > left && bottom > top) target = { left, top, width: right - left, height: bottom - top };
      }
      const bodyOverflow = Math.max(0, (bodyRef.current?.scrollHeight ?? 0) - (bodyRef.current?.clientHeight ?? 0));
      const naturalHeight = cardRef.current ? cardRef.current.scrollHeight + bodyOverflow + 2 : 280;
      const next = {
        target,
        ...placeOfficeGuide(target, viewport, naturalHeight),
      };
      setLayout((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    targets()[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
    const composer = document.querySelector('[data-welcome-input-root]');
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    if (composer) resize?.observe(composer);
    if (cardRef.current) resize?.observe(cardRef.current);
    if (bodyRef.current) resize?.observe(bodyRef.current);
    targets().forEach((target) => resize?.observe(target));
    const mutations = new MutationObserver(scheduleMeasure);
    if (composer) mutations.observe(composer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', scheduleMeasure);
    document.addEventListener('scroll', scheduleMeasure, true);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      document.removeEventListener('scroll', scheduleMeasure, true);
    };
  }, [selectors]);

  useEffect(() => {
    const target = document.querySelector<HTMLElement>(selectors[0] ?? ':not(*)');
    const previousDescription = target?.getAttribute('aria-describedby');
    target?.setAttribute('aria-describedby', [previousDescription, 'office-guide-description'].filter(Boolean).join(' '));
    const frame = requestAnimationFrame(() => {
      const focusTarget = step === 'category' || step === 'task' || step === 'compose'
        ? target
        : cardRef.current?.querySelector<HTMLElement>('[data-office-guide-primary]');
      focusTarget?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        document.querySelector<HTMLTextAreaElement>('[data-welcome-composer-input]')?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusableSelector = 'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex="0"]';
      const nodes = selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]);
      const focusable = [...new Set([
        ...nodes.flatMap((node) => [
          ...(node.matches(focusableSelector) ? [node] : []),
          ...node.querySelectorAll<HTMLElement>(focusableSelector),
        ]),
        ...(cardRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
      ])];
      if (!focusable.length) return;
      event.preventDefault();
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousDescription == null) target?.removeAttribute('aria-describedby');
      else target?.setAttribute('aria-describedby', previousDescription);
    };
  }, [step, selectors, close]);

  if (!storedStep) return null;
  const finish = () => { close(); onEdit(); };
  const copy = {
    welcome: {
      title: isEn ? 'Let’s write your first document' : '一起写一份工作材料',
      description: isEn ? 'Try Draft and polish materials to learn how workspaces, skills, and source files work together.' : '从「撰写与润色材料」开始，跟着点击，认识工作空间、技能和资料的用法。',
      action: isEn ? 'Show me how' : '带我试一次',
    },
    category: {
      title: isEn ? 'Click Office' : '先点「综合办公」',
      description: isEn ? 'Start with everyday work: writing materials, meeting minutes, or weekly reports.' : '材料撰写、会议纪要、工作周报，都可以从这里开始。',
      action: isEn ? 'Open Office' : '打开综合办公',
    },
    task: {
      title: isEn ? 'Choose Draft and polish materials' : '选择「撰写与润色材料」',
      description: isEn ? 'This prepares an office workspace, binds your editing skill, adds image reading, and fills an editable writing request.' : '点击后会准备办公工作空间、绑定你的润色技能、加入图片识别，并填好一段可修改的写作要求。',
      action: isEn ? 'Choose this task' : '选择这个任务',
    },
    workspace: {
      title: isEn ? 'Your documents have a home' : '文档有自己的存放位置',
      description: isEn ? 'Generated documents will be saved in 我的综合办公. Return to this workspace to continue editing them.' : '生成的文档会保存在「我的综合办公」，下次回到这个工作空间，就能接着处理。',
      action: isEn ? 'Explore the skills' : '看看已加入的技能',
    },
    skills: {
      title: isEn ? 'Editing and image-reading skills' : '润色和图片识别能力已带上',
      description: isEn ? 'Your editing skill removes boilerplate and improves wording while preserving facts and a professional tone; image-extract reads screenshots. Use + to add capabilities, or hover a tag to remove it.' : '已加入的润色技能负责去套话、改善表达，保留事实和正式语气；image-extract 负责识别截图文字。以后可从「+」添加能力，移到标签上可删除。',
      action: isEn ? 'Add your requirements' : '补充我的要求',
    },
    compose: {
      title: isEn ? 'Make this request your own' : '写下你要做的材料',
      description: isEn ? 'Add a topic, audience and length, or try an example. Attach sources with +.' : '补充主题、读者和篇幅，或选择示例试写。资料可通过「+」添加。',
      action: isEn ? 'Start editing' : '开始编辑',
    },
  }[step];
  const primaryAction = () => {
    if (step === 'welcome') { onStart(); advance('welcome', 'category'); }
    else if (step === 'category') onSelectCategory();
    else if (step === 'task') onSelectTask();
    else if (step === 'workspace') advance('workspace', 'skills');
    else if (step === 'skills') advance('skills', 'compose');
    else finish();
  };
  const target = layout.target;
  const shade = 'office-guide-shade pointer-events-auto absolute';

  return createPortal(
    <div data-office-task-guide={step} className="window-modal-viewport pointer-events-none fixed inset-0 z-[90] [app-region:no-drag]">
      {target ? <>
        <div aria-hidden="true" className={shade} style={{ inset: '0 0 auto', height: target.top }} />
        <div aria-hidden="true" className={shade} style={{ top: target.top, left: 0, width: target.left, height: target.height }} />
        <div aria-hidden="true" className={shade} style={{ top: target.top, left: target.left + target.width, right: 0, height: target.height }} />
        <div aria-hidden="true" className={shade} style={{ top: target.top + target.height, bottom: 0, left: 0, right: 0 }} />
        <div data-office-guide-highlight aria-hidden="true" className="office-guide-highlight absolute rounded-xl border" style={{ ...target }} />
      </> : <div aria-hidden="true" className={`${shade} inset-0 backdrop-blur-[3px]`} />}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal={step === 'welcome' ? true : undefined}
        aria-labelledby="office-guide-title"
        aria-describedby="office-guide-description"
        data-office-guide-card
        className={`office-guide-card pointer-events-auto absolute flex flex-col overflow-hidden rounded-[20px] border ${step === 'compose' ? 'p-4' : 'p-5'}`}
        style={{ left: layout.left, top: layout.top, width: layout.width, maxHeight: layout.maxHeight }}
      >
        <div className={`flex shrink-0 items-center justify-between gap-3 ${step === 'compose' ? 'mb-2' : 'mb-3'}`}>
          <span className={`office-guide-heading flex items-center gap-2 font-medium ${step === 'compose' ? 'text-[13px]' : 'text-[11px]'}`}>
            <FilePenLine className="h-4 w-4 shrink-0 text-[var(--cowork-blue)]" />
            {step === 'compose' ? copy.title : isEn ? 'Quick start · Office' : '快速上手 · 综合办公'}
            {step !== 'welcome' && <span className="office-guide-progress shrink-0 rounded-md px-1.5 py-0.5 text-[11px] leading-4 tabular-nums">{STEPS.indexOf(step) + 1}/5</span>}
          </span>
          <Button type="button" variant="ghost" size="icon-xs" onClick={finish} data-office-guide-close aria-label={isEn ? 'Skip tutorial' : '跳过引导'} className="text-[var(--cowork-muted)]"><X className="size-3.5" /></Button>
        </div>
        <div ref={bodyRef} className="min-h-0 overflow-y-auto overscroll-contain">
        <h2 id="office-guide-title" className={step === 'compose' ? 'sr-only' : 'text-[16px] font-semibold leading-6'}>{copy.title}</h2>
        <p id="office-guide-description" className={`text-[var(--cowork-text)] ${step === 'compose' ? 'text-[12px] leading-5' : 'mt-2 text-[13px] leading-[1.7]'}`}>{copy.description}</p>
        {step === 'task' && error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300">{error}</p>}
        {step === 'compose' && <div className="mt-2 flex flex-wrap gap-2">
          {OFFICE_WRITING_EXAMPLES.map((example) => <Button
            type="button"
            variant="outline"
            size="sm"
            key={example.key}
            data-office-guide-example={example.key}
            onClick={() => { onUseExample(example); close(); }}
            className="office-guide-example h-auto px-2.5 py-1.5 text-[12px] font-normal has-[>svg]:px-2.5"
          >{isEn ? example.labelEn : example.labelZh}<ArrowRight className="size-3" /></Button>)}
        </div>}
        {step === 'compose' && needsModel && <button type="button" onClick={() => { close(); onConfigureModel(); }} className="mt-3 text-left text-[12px] text-[var(--cowork-blue)] underline underline-offset-4">{isEn ? 'Configure a model before sending; your draft will be kept.' : '发送前先配置模型，当前要求会保留。'}</button>}
        </div>
        <div className={`flex shrink-0 items-center justify-between gap-3 ${step === 'compose' ? 'mt-3' : 'mt-5'}`}>
          <button type="button" onClick={finish} className="shrink-0 rounded-md text-[12px] text-[var(--cowork-muted)] hover:text-[var(--cowork-ink)]">{step === 'welcome' ? (isEn ? 'Start on my own' : '直接开始') : (isEn ? 'Skip' : '跳过引导')}</button>
          <Button
            type="button"
            data-office-guide-primary
            disabled={step === 'task' && (preparing || disabled)}
            onClick={primaryAction}
            className="h-auto min-h-9 px-3.5 py-2 text-[12px] has-[>svg]:px-3.5 disabled:cursor-wait"
          >{step === 'task' && preparing ? <><Loader2 className="size-3.5 animate-spin" />{isEn ? 'Preparing…' : '正在准备…'}</> : <>{copy.action}<ArrowRight className="size-3.5" /></>}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
