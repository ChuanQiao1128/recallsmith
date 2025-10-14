Modular monolith with DDD:
- **Admin Web** (React + TypeScript)
- **API Host** (ASP.NET Core)
- **Mobile App** (React Native)

**Data rules**: every table has `created_at`, `updated_at`, `is_deleted` (soft delete).  
**Language**: English-only content (i18n later).

Folders:
- `apps/` – API host, admin web, mobile app
- `modules/` – bounded contexts: `catalog`, `study` (Domain/Application/Infrastructure/Api)
- `building-blocks/` – shared kernel & cross-cutting infra
- `contracts/` – OpenAPI spec & DTOs
- `db/` – migrations (DDL/triggers/indexes), seed data
- `docs/` – architecture & runbooks
