// src/hooks/useManifest.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminManifest, rebuildManifest } from '../api/authoring';
import { QueryKeys } from '../api/queryClient';

// 获取 Manifest
export function useManifest() {
  return useQuery({
    queryKey: QueryKeys.manifest(),
    queryFn: async () => {
      const res = await fetchAdminManifest();
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to fetch manifest');
      return res.data;
    },
    // Manifest 不频繁变化，设置更长的 stale time
    staleTime: 2 * 60 * 1000, // 2分钟
  });
}

// 重建 Manifest
export function useRebuildManifest() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const res = await rebuildManifest();
      if (!res.success) throw new Error(res.error?.message ?? 'Failed to rebuild manifest');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QueryKeys.manifest() });
    },
  });
}
