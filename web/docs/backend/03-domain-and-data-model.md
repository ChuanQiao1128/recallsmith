1. Domain 概念
   • Deck：题库（slug 唯一、人类可读；latest_version 仅在发布后更新）。
   • Card：隶属某 Deck 的卡片。用 stable_uid 确定幂等（Upsert）。
   • Publish：将 Deck 当前非删除的卡片集合导出为只读包（deck.sqlite），生成 manifest.json，并刷新 catalog.json。
2. 约束与不变量
   • decks.slug 唯一。
   • 每个 deck 下 cards(stable_uid) 唯一。
   • 所有表保留 created_at, updated_at, is_deleted；删除为软删。
   • 时间均存 UTC ISO8601。
3. 关系模型（简化 + 企业可用）
   PostgreSQL
   create table if not exists decks (
   deck_id uuid primary key,
   slug varchar(128) not null unique,
   title varchar(256) not null,
   locale varchar(32) not null default 'en-US',
   latest_version varchar(64),
   published_at timestamptz,
   created_at timestamptz not null,
   updated_at timestamptz not null,
   is_deleted boolean not null default false
   );

create table if not exists cards (
card_id uuid primary key,
deck_id uuid not null references decks(deck_id),
stable_uid varchar(64) not null,
front_md text not null,
back_md text not null,
difficulty varchar(16), -- e.g. Easy/Medium/Hard
created_at timestamptz not null,
updated_at timestamptz not null,
is_deleted boolean not null default false,
unique(deck_id, stable_uid)
);
SQLite（开发默认）
-- 字段相同，类型简化为 text/integer，uuid 存 text

4. why 不存“每张卡的版本”
   • 发布即版本：版本与“包”绑定，而不是与卡绑定，减少作者心智负担。
   • 需要追下历史对比时，可在发布产物中保留 manifest.json 与 catalog.json 历史（S3 版本化），或在后续新增 changelog 表（不是当下必需）。
