import { ArrowRight, Check, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  UIInteractivePrompt,
  UIInteractivePromptAnswer,
  UIInteractivePromptQuestion,
} from '@/core/types';
import { cn } from '@/lib/utils';

export interface InteractivePromptSubmitPayload {
  answer: UIInteractivePromptAnswer;
  text: string;
  answeredText?: string;
}

type DraftAnswer = {
  answerType: 'option' | 'freeform';
  optionId?: string;
  text: string;
};

function promptQuestions(prompt: UIInteractivePrompt): UIInteractivePromptQuestion[] {
  if (prompt.questions?.length) return prompt.questions;
  return [{
    id: 'default',
    question: prompt.question,
    options: prompt.options,
    allowFreeform: true,
    answeredOptionId: prompt.answeredOptionId,
    answeredText: prompt.answeredText,
  }];
}

function initialAnswers(questions: UIInteractivePromptQuestion[]): Record<string, DraftAnswer> {
  const out: Record<string, DraftAnswer> = {};
  for (const question of questions) {
    const text = question.answeredText?.trim();
    if (text) {
      out[question.id] = {
        answerType: question.answeredOptionId ? 'option' : 'freeform',
        optionId: question.answeredOptionId,
        text,
      };
    }
  }
  return out;
}

function initialFreeformDrafts(questions: UIInteractivePromptQuestion[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const question of questions) {
    if (!question.answeredOptionId && question.answeredText?.trim()) {
      out[question.id] = question.answeredText;
    }
  }
  return out;
}

export default function InteractivePromptCard({
  prompt,
  onSubmit,
  compact = false,
  submitting = false,
  error,
}: {
  prompt: UIInteractivePrompt;
  onSubmit?: (payload: InteractivePromptSubmitPayload) => void;
  compact?: boolean;
  submitting?: boolean;
  error?: string | null;
}) {
  const questions = useMemo(() => promptQuestions(prompt), [prompt]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>(() => initialAnswers(questions));
  const [freeformByQuestion, setFreeformByQuestion] = useState<Record<string, string>>(() => initialFreeformDrafts(questions));
  const disabled = prompt.status !== 'pending' || !onSubmit || submitting;
  const current = questions[Math.min(index, questions.length - 1)];
  const currentAnswer = current ? answers[current.id] : undefined;
  const currentFreeform = current ? freeformByQuestion[current.id] ?? '' : '';

  const submitAll = (nextAnswers = answers) => {
    const payloadAnswers = questions.map((question) => {
      const answer = nextAnswers[question.id];
      if (!answer?.text.trim()) return null;
      return {
        questionId: question.id,
        answerType: answer.answerType,
        optionId: answer.optionId,
        text: answer.text.trim(),
      };
    });
    if (payloadAnswers.some((answer) => answer == null)) return;
    const text = questions.map((question, questionIndex) => (
      `Q: ${question.question} A: ${payloadAnswers[questionIndex]?.text ?? ''}`
    )).join('\n\n');
    onSubmit?.({
      answer: {
        promptId: prompt.promptId,
        answerType: questions.length === 1 && payloadAnswers[0]?.answerType !== 'freeform' ? 'option' : 'group',
        optionId: questions.length === 1 ? payloadAnswers[0]?.optionId : undefined,
        answers: payloadAnswers.filter((answer): answer is NonNullable<typeof answer> => answer != null),
      },
      text,
      answeredText: text,
    });
  };

  const recordAnswer = (answer: DraftAnswer) => {
    if (!current) return;
    const next = { ...answers, [current.id]: answer };
    setAnswers(next);
    if (questions.length === 1) {
      submitAll(next);
      return;
    }
    if (index < questions.length - 1) {
      setIndex(index + 1);
      return;
    }
    if (questions.every((question) => !!next[question.id]?.text.trim())) {
      submitAll(next);
    }
  };

  if (!current) return null;

  return (
    <div
      className={cn(
        'w-full rounded-2xl border border-[#e2ded6] bg-white shadow-[0_1px_2px_rgba(41,38,27,0.08)]',
        compact ? 'px-4 py-4' : 'mt-3 max-w-[42rem] px-4 py-4',
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cn('font-medium leading-[1.35] text-[#29261b]', compact ? 'text-[18px]' : 'text-[22px]')}>
            {current.question}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[#8b887c]">
          {questions.length > 1 ? (
            <>
              <button
                type="button"
                disabled={disabled || index === 0}
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[#f3f0ea] disabled:opacity-35"
                aria-label="上一题"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-12 text-center text-[14px]">{index + 1} of {questions.length}</span>
              <button
                type="button"
                disabled={disabled || index === questions.length - 1}
                onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[#f3f0ea] disabled:opacity-35"
                aria-label="下一题"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          ) : null}
          {prompt.allowSkip ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSubmit?.({
                answer: { promptId: prompt.promptId, answerType: 'skip' },
                text: '跳过',
                answeredText: '已跳过',
              })}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[#f3f0ea] disabled:opacity-35"
              aria-label="跳过"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="divide-y divide-[#ebe7df] overflow-hidden rounded-2xl bg-[#f4f3f1]">
        {current.options.map((option, optionIndex) => {
          const selected = currentAnswer?.optionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => recordAnswer({ answerType: 'option', optionId: option.id, text: option.label })}
              className={cn(
                'group flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                !disabled && 'hover:bg-[#eeece8]',
                disabled && 'cursor-default opacity-80',
                selected && 'bg-[#eeece8]',
              )}
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#deddd9] text-[15px] font-medium text-[#656358]">
                {selected ? <Check className="h-4 w-4 text-[#d97757]" /> : optionIndex + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-6 text-[#29261b]">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block text-[13px] leading-5 text-[#7d796f]">{option.description}</span>
                ) : null}
              </span>
              {!disabled ? <ArrowRight className="h-4 w-4 shrink-0 text-[#8b887c] opacity-0 transition-opacity group-hover:opacity-100" /> : null}
            </button>
          );
        })}
        <form
          className="flex min-h-14 items-center gap-3 bg-white px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            const text = currentFreeform.trim();
            if (!text) return;
            recordAnswer({ answerType: 'freeform', text });
          }}
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#f0efeb] text-[#656358]">
            <ArrowRight className="h-4 w-4" />
          </span>
          <input
            value={currentFreeform}
            onChange={(event) => {
              const value = event.target.value;
              setFreeformByQuestion((drafts) => ({
                ...drafts,
                [current.id]: value,
              }));
            }}
            disabled={disabled}
            placeholder="其他"
            className="min-w-0 flex-1 border-none bg-transparent text-[15px] leading-6 text-[#29261b] outline-none placeholder:text-[#9b968c]"
          />
          <button
            type="submit"
            disabled={disabled || !currentFreeform.trim()}
            className="text-[13px] font-medium text-[#d97757] disabled:text-[#c9c3b8]"
          >
            使用
          </button>
        </form>
      </div>

      {submitting || error ? (
        <div className="mt-3 min-h-5 text-[13px] text-[#8b887c]">
          {submitting ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在提交
            </span>
          ) : error ? (
            <span className="text-[#b5472f]">{error}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
