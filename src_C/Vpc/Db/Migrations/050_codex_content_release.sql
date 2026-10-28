-- Additive deck-scoped release policy. Existing live content remains readable.
alter table decks add column if not exists release_generation bigint not null default 0;
alter table deck_publishes add column if not exists release_generation bigint;
alter table deck_publishes add column if not exists release_receipt_id text;
alter table deck_publishes add column if not exists release_editing_snapshot text;
alter table deck_publishes add column if not exists release_expected_live text;
create table if not exists content_release_actions (
 deck_id bigint not null references decks(id), release_id text not null, action_id text not null,
 kind text not null, payload_hash text not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(deck_id, release_id, action_id)
);
create table if not exists content_review_receipts (
 id text primary key, deck_id bigint not null references decks(id), release_id text not null,
 action_id text not null, payload_hash text not null, editing_snapshot text not null, publish_snapshot text not null,
 policy text not null check(policy='aws-codex-bilingual-v1'), evidence jsonb not null,
 reviewed_by text not null default 'codex' check(reviewed_by='codex'),
 human_per_card_review boolean not null default false check(not human_per_card_review),
 submitted_by text not null, expires_at timestamptz not null, created_at timestamptz not null default now(),
 unique(deck_id,release_id,action_id)
);
create table if not exists content_review_revocations (
 receipt_id text primary key references content_review_receipts(id), reason text not null,
 actor_sub text not null, created_at timestamptz not null default now()
);
create or replace function content_editing_snapshot(did bigint) returns text language sql stable as $$
 select encode(sha256(convert_to(jsonb_build_object(
 'schema','editing-v1',
 'deck',(select to_jsonb(d)-'updated_at'-'live_build_id'-'release_generation'-'total_cards' from decks d where d.id=did),
 'cards',(select coalesce(jsonb_agg(to_jsonb(c)-'updated_at'-'created_at' order by c.order_in_deck,c.id),'[]'::jsonb) from cards c where c.deck_id=did)
 )::text,'UTF8')),'hex')
$$;
create or replace function content_release_card_lock() returns trigger language plpgsql as $$
declare did bigint; protected boolean;
begin
 did := case when TG_OP='DELETE' then OLD.deck_id else NEW.deck_id end;
 select slug='aws-saa-fundamentals' into protected from decks where id=did;
 if protected then perform id from decks where id=did for update; end if;
 if TG_OP='UPDATE' and OLD.deck_id<>NEW.deck_id then
   if protected or exists(select 1 from decks where id=OLD.deck_id and slug='aws-saa-fundamentals') then raise exception 'RELEASE_DECK_MOVE_FORBIDDEN'; end if;
 end if;
 if protected and TG_OP='UPDATE' then
   if OLD.is_deleted=1 and NEW.is_deleted=0 then raise exception 'SOFT_DELETED_UID'; end if;
   if NEW.stable_uid<>OLD.stable_uid then raise exception 'RELEASE_UID_IMMUTABLE'; end if;
   if (to_jsonb(NEW)-'version'-'revision'-'updated_at'-'created_at') is distinct from (to_jsonb(OLD)-'version'-'revision'-'updated_at'-'created_at') then
     NEW.revision := OLD.revision+1;
   end if;
 end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $$;
drop trigger if exists content_release_card_lock on cards;
create trigger content_release_card_lock before insert or update or delete on cards for each row execute function content_release_card_lock();
create or replace function content_release_job_guard() returns trigger language plpgsql as $$
declare d decks%rowtype; r content_review_receipts%rowtype;
begin
 select * into d from decks where id=NEW.deck_id for update;
 if d.slug<>'aws-saa-fundamentals' then return NEW; end if;
 if NEW.status in ('PENDING','PROCESSING','SUCCESS') then
   select * into r from content_review_receipts where id=NEW.release_receipt_id;
   if NEW.release_generation is null or NEW.release_generation<>d.release_generation or r.id is null
     or r.deck_id<>NEW.deck_id or r.expires_at<=clock_timestamp()
     or exists(select 1 from content_review_revocations where receipt_id=r.id)
     or NEW.release_editing_snapshot is distinct from r.editing_snapshot
     or r.editing_snapshot<>content_editing_snapshot(d.id)
     or NEW.qa_snapshot_sha256 is distinct from r.publish_snapshot
     or NEW.release_expected_live is distinct from d.live_build_id
     or d.is_deleted<>0 then raise exception 'CODEX_REVIEW_REQUIRED_OR_STALE' using errcode='P0001'; end if;
   if NEW.status='SUCCESS' and (NEW.content_sha256 is null or NEW.content_sha256 !~ '^[0-9a-f]{64}$' or coalesce(NEW.content_bytes,0)<=0) then raise exception 'RELEASE_UPLOAD_INTEGRITY_REQUIRED'; end if;
   if TG_OP='UPDATE' and OLD.status='FAILED' then raise exception 'RELEASE_GENERATION_CANCELLED'; end if;
 end if;
 return NEW;
end $$;
drop trigger if exists content_release_job_guard on deck_publishes;
create trigger content_release_job_guard before insert or update on deck_publishes for each row execute function content_release_job_guard();
-- A live pointer may only move to a currently authorized successful generation, or through the CAS rollback transaction.
create or replace function content_release_live_guard() returns trigger language plpgsql as $$
begin
 if OLD.slug='aws-saa-fundamentals' then
   if NEW.slug<>OLD.slug then raise exception 'RELEASE_SLUG_IMMUTABLE'; end if;
   if NEW.live_build_id is distinct from OLD.live_build_id and coalesce(current_setting('recallsmith.rollback_deck',true),'')<>OLD.id::text then
     if not exists(select 1 from deck_publishes p join content_review_receipts r on r.id=p.release_receipt_id
       where p.deck_id=OLD.id and p.build_id=NEW.live_build_id and p.status='SUCCESS'
       and p.release_generation=NEW.release_generation and p.release_expected_live is not distinct from OLD.live_build_id
       and r.expires_at>clock_timestamp() and not exists(select 1 from content_review_revocations x where x.receipt_id=r.id)
       and r.editing_snapshot=content_editing_snapshot(OLD.id)) then raise exception 'RELEASE_LIVE_COMMIT_DENIED'; end if;
   end if;
 end if;
 return NEW;
end $$;
drop trigger if exists content_release_live_guard on decks;
create trigger content_release_live_guard before update on decks for each row execute function content_release_live_guard();
create or replace function content_release_immutable() returns trigger language plpgsql as $$ begin raise exception 'RELEASE_EVIDENCE_IMMUTABLE'; end $$;
drop trigger if exists content_review_immutable on content_review_receipts;
create trigger content_review_immutable before update or delete on content_review_receipts for each row execute function content_release_immutable();
drop trigger if exists content_revocation_immutable on content_review_revocations;
create trigger content_revocation_immutable before update or delete on content_review_revocations for each row execute function content_release_immutable();
-- Source invalidations and final live commits use the same deck lock. A source event after a review
-- revokes that evidence; a review registered after the event is a new explicit author assertion.
create or replace function content_release_source_invalidate() returns trigger language plpgsql as $$
declare did bigint; target source_watch_targets%rowtype;
begin
 if NEW.kind not in ('changed','gone','failing','unsupported','feed_items') then return NEW; end if;
 select * into target from source_watch_targets where id=NEW.target_id;
 for did in select d.id from decks d where d.slug='aws-saa-fundamentals' and
   (target.deck_id=d.id or exists(select 1 from cards c where c.deck_id=d.id and c.is_deleted=0 and
      (c.source->>'url'=target.url or position(target.url in coalesce(c.front_help::text,''))>0))) for update of d
 loop
   insert into content_review_revocations(receipt_id,reason,actor_sub)
     select id,'SOURCE_INVALIDATED:'||NEW.kind,'source-watch' from content_review_receipts where deck_id=did on conflict do nothing;
   update decks set release_generation=release_generation+1 where id=did;
   update deck_publishes set status='FAILED',error_message='SOURCE_INVALIDATED',updated_at=now()
     where deck_id=did and status in('PENDING','PROCESSING');
 end loop;
 return NEW;
end $$;
drop trigger if exists content_release_source_invalidate on source_watch_events;
create trigger content_release_source_invalidate before insert on source_watch_events for each row execute function content_release_source_invalidate();
-- Retire queued cloud reviews without representing them as completed reviews.
update ai_qa_runs set status='failed',error_code='CLOUD_QA_RETIRED',finished_at=now(),updated_at=now()
 where deck_id in(select id from decks where slug='aws-saa-fundamentals') and status in('queued','running');
update ai_qa_items set status='skipped',error_code='CLOUD_QA_RETIRED',updated_at=now()
 where run_id in(select id from ai_qa_runs where error_code='CLOUD_QA_RETIRED' and deck_id in(select id from decks where slug='aws-saa-fundamentals')) and status='queued';
create or replace function content_release_revocation_lock() returns trigger language plpgsql as $$
begin
 perform d.id from decks d join content_review_receipts r on r.deck_id=d.id where r.id=NEW.receipt_id for update of d;
 return NEW;
end $$;
drop trigger if exists content_release_revocation_lock on content_review_revocations;
create trigger content_release_revocation_lock before insert on content_review_revocations for each row execute function content_release_revocation_lock();
drop trigger if exists content_release_action_immutable on content_release_actions;
create trigger content_release_action_immutable before update or delete on content_release_actions for each row execute function content_release_immutable();

-- Existing draft review decisions retire through the old allowed human state, with an explicit machine audit.
with queued as (
 select draft_id,state from automation_draft_decisions where deck_id in(select id from decks where slug='aws-saa-fundamentals')
 and state in('qa_pending','qa_queued') for update
), retired as (
 update automation_draft_decisions d set state='human',reason='QA_UNAVAILABLE',reason_detail='CLOUD_QA_RETIRED: aws-codex-bilingual-v1',
   qa_status='skipped',qa_error_code='CLOUD_QA_RETIRED',updated_at=now(),decided_at=now()
 from queued q where d.draft_id=q.draft_id returning d.draft_id,d.mode,q.state as old_state
)
insert into automation_decision_events(draft_id,actor,from_state,to_state,reason,mode,details)
select draft_id,'automation',old_state,'human','QA_UNAVAILABLE',mode,'{"policy":"aws-codex-bilingual-v1","code":"CLOUD_QA_RETIRED"}'::jsonb from retired;
