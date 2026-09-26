-- =========================
-- 023_admin_audit.sql
-- Append-only audit trail for console admin mutations (CBE-12). Additive: nothing existing changes,
-- so code running before this migration is unaffected. Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

create table if not exists admin_audit (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  actor_sub text null,
  actor_username text null,
  action text not null,
  target text not null,
  before_state jsonb null,
  after_state jsonb null,
  trace_id text null
);

create index if not exists idx_admin_audit_created_at on admin_audit(created_at desc);
create index if not exists idx_admin_audit_target on admin_audit(target, created_at desc);

create or replace function admin_audit_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'admin_audit is append-only';
end
$$;

drop trigger if exists trg_admin_audit_no_update on admin_audit;
create trigger trg_admin_audit_no_update
  before update or delete on admin_audit
  for each row execute function admin_audit_append_only();

drop trigger if exists trg_admin_audit_no_truncate on admin_audit;
create trigger trg_admin_audit_no_truncate
  before truncate on admin_audit
  for each statement execute function admin_audit_append_only();
