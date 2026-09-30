-- =========================
-- 038_card_embeddings.sql
-- Card embeddings for semantic similarity (R20 V06, contract R20-00 §5). Additive: nothing existing changes.
-- The vector extension (pgvector) is installed only when it is available on the server AND has_database_privilege
-- says the migrating role holds CREATE on the database; otherwise a NOTICE is raised and every vector route answers
-- 503 VECTOR_NOT_READY (/cards/similar keeps its trigram engine). Prod's app role cannot create extensions, so there
-- the owner runs CREATE EXTENSION vector as the RDS master and then re-applies this file (docs/runbooks).
-- card_embeddings is created only when the extension exists, through execute, because the vector type does not
-- parse without it. No ANN index this round (about 900 rows; exact scan). Every statement is idempotent.
-- =========================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    if not exists (select 1 from pg_available_extensions where name = 'vector') then
      raise notice 'vector not installed: the extension is not available on this server; card embeddings stay off (VECTOR_NOT_READY)';
    elsif has_database_privilege(current_user, current_database(), 'CREATE') then
      create extension if not exists vector;
    else
      raise notice 'vector not installed: % lacks CREATE on database %; card embeddings stay off (VECTOR_NOT_READY)',
        current_user, current_database();
    end if;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute $ddl$
      create table if not exists card_embeddings (
        card_id bigint primary key references cards(id) on delete cascade,
        model text not null,
        dim int not null,
        text_sha256 text not null,
        embedding vector(384) not null,
        updated_at timestamptz not null default now()
      )
    $ddl$;
  end if;
end $$;
