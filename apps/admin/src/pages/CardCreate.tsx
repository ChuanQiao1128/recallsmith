import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { createDraftCard } from '../api/admin';

import type { CreateDraftCardResponse } from '../types/dto';
import './CardCreate.css';

const schema = z.object({
  deckId: z.string().uuid(),
  stableUid: z.string().min(3),
  frontMd: z.string().min(1),
  backMd: z.string().min(1),
  keyPoint: z.string().min(1).max(200),
  // 用 default('') 时：输入类型是 string | undefined，输出类型是 string
  // 这里我们用“输入类型”作为表单类型（见下方 FormValues）
  tagsCsv: z.string().default(''),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional()
});

// 关键：用“输入类型”作为表单泛型，避免 resolver 的输入/输出不匹配
type FormValues = z.input<typeof schema>;

function parseTags(csv?: string) {
  if (!csv) return [];
  return csv.split(',').map(s => s.trim()).filter(Boolean);
}

export default function CardCreate() {
  const lastDeck = localStorage.getItem('lastDeckId') ?? '';

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      deckId: lastDeck,
      difficulty: 'intermediate',
      tagsCsv: ''
    }
  });

  // 明确三段泛型：<返回值, 错误, 变量(表单类型)>
  const m = useMutation<CreateDraftCardResponse, Error, FormValues>({
    mutationFn: async (v) => {
      // 这里进行“表单值 → API DTO”的安全映射
      return createDraftCard(v.deckId, {
        stableUid: v.stableUid,
        frontMd: v.frontMd,
        backMd: v.backMd,
        keyPoint: v.keyPoint,
        tags: parseTags(v.tagsCsv),
        difficulty: v.difficulty
      });
    },
    onSuccess: (res) => {
      alert(`Card created: ${res.cardId}\nuid=${res.stableUid}`);
      reset({
        deckId: lastDeck,
        stableUid: '',
        frontMd: '',
        backMd: '',
        keyPoint: '',
        tagsCsv: '',
        difficulty: 'intermediate'
      });
    },
    onError: (e) => alert(e.message || 'An error occurred')
  });

  return (
    <div className="container">
      <h2>Create Draft Card</h2>
      <form onSubmit={handleSubmit(values => m.mutate(values))}>
        <label>Deck ID<br /><input {...register('deckId')} placeholder="deck uuid" /></label>
        <div className="error">{errors.deckId?.message}</div>

        <label>Stable UID<br /><input {...register('stableUid')} placeholder="js.eventloop.micro-vs-macro.v1" /></label>
        <div className="error">{errors.stableUid?.message}</div>

        <label>Key Point<br /><input {...register('keyPoint')} placeholder="One-sentence takeaway" /></label>
        <div className="error">{errors.keyPoint?.message}</div>

        <label>Tags (comma-separated)<br /><input {...register('tagsCsv')} placeholder="JavaScript,event-loop" /></label>

        <label>Difficulty<br />
          <select {...register('difficulty')}>
            <option value="beginner">beginner</option>
            <option value="intermediate">intermediate</option>
            <option value="advanced">advanced</option>
          </select>
        </label>

        <label>Front (Markdown)<br /><textarea rows={5} {...register('frontMd')} /></label>
        <div className="error">{errors.frontMd?.message}</div>

        <label>Back (Markdown)<br /><textarea rows={10} {...register('backMd')} /></label>
        <div className="error">{errors.backMd?.message}</div>

        <div className="submit-button">
          <button disabled={isSubmitting || m.isPending} type="submit">Create Card</button>
        </div>
      </form>
    </div>
  );
}