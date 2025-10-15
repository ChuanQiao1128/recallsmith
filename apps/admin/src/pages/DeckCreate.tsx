import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { createDeck } from '../api/admin';
import { parseApiError } from '../api/client';
import type { CreateDeckResponse } from '../types/dto';
import './DeckCreate.css';

const schema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,32}$/i, '3-32 chars, lowercase letters/digits/dash'),
  title: z.string().min(1).max(100),
  // 这里把 locale 变成：输入可为 string | '' | undefined，输出为 string | undefined
  locale: z.string().optional().or(z.literal('')).transform(v => v || undefined)
});

// 用“输入类型”作为表单类型
type FormValues = z.input<typeof schema>;

export default function DeckCreate() {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { locale: 'en-US' }
  });

  // 明确三段泛型，并把表单值映射成 API DTO
  const m = useMutation<CreateDeckResponse, Error, FormValues>({
    mutationFn: async (v) => createDeck({
      slug: v.slug,
      title: v.title,
      // v.locale 在输入上可能是 string | '' | undefined，后端 DTO 是 string | null
      locale: v.locale ?? undefined
    }),
    onSuccess: (res) => {
      localStorage.setItem('lastDeckId', res.deckId);
      alert(`Created deck: ${res.deckId}`);
      reset({ slug: '', title: '', locale: 'en-US' });
    },
    onError: async (e) => alert(await parseApiError(e))
  });

  return (
    <div className="container">
      <h2>Create Deck</h2>
      <form onSubmit={handleSubmit(values => m.mutate(values))}>
        <label>Slug<br />
          <input {...register('slug')} placeholder="js-core" />
        </label>
        <div className="error">{errors.slug?.message}</div>

        <label>Title<br />
          <input {...register('title')} placeholder="JavaScript Core" />
        </label>
        <div className="error">{errors.title?.message}</div>

        <label>Locale<br />
          <input {...register('locale')} placeholder="en-US" />
        </label>

        <div className="submit-button">
          <button disabled={isSubmitting || m.isPending} type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}