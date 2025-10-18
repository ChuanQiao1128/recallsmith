import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { publishDeck } from '../api/admin';

import type { PublishDeckResponse } from '../types/dto';
import './Publish.css';

const schema = z.object({
  deckId: z.string().uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'SemVer: x.y.z'),
  // default('') → 输入：string | undefined；输出：string
  changelog: z.string().default('')
});

// 用“输入类型”作为表单类型
type FormValues = z.input<typeof schema>;

export default function Publish() {
  const lastDeck = localStorage.getItem('lastDeckId') ?? '';
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { deckId: lastDeck, version: '1.0.0', changelog: '' }
  });

  const m = useMutation<PublishDeckResponse, Error, FormValues>({
    mutationFn: async (v) => publishDeck(v.deckId, {
      version: v.version,
      changelog: v.changelog ?? ''
    }),
    onSuccess: (res) => alert(`Published ${res.version}\nCards: ${res.totalCards}\nAt: ${res.publishedAt}`),
    onError: (e) => alert(e.message || 'An error occurred')
  });

  return (
    <div className="container">
      <h2>Publish Deck</h2>
      <form onSubmit={handleSubmit(values => m.mutate(values))}>
        <label>Deck ID<br /><input {...register('deckId')} /></label>
        <div className="error">{errors.deckId?.message}</div>

        <label>Version (x.y.z)<br /><input {...register('version')} /></label>
        <div className="error">{errors.version?.message}</div>

        <label>Changelog<br /><textarea rows={4} {...register('changelog')} /></label>

        <div className="submit-button">
          <button disabled={isSubmitting || m.isPending} type="submit">Publish</button>
        </div>
      </form>
    </div>
  );
}