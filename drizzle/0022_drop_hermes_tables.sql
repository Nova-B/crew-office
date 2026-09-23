-- crew-office: Hermes 시절 표·컬럼을 걷어낸다. 앱 코드는 이미 지웠고(c7a0c74) 실제 사용자 DB 의 이 표들은 비어 있다.
-- 순서: npcs 의 프로필 참조(인덱스·FK·컬럼)를 먼저 끊고 → 자식 표부터 표를 지운다.
-- npcs·npc_sessions·chat_messages 의 행은 건드리지 않는다. SQLite 쪽은 src/db/sqlite-drop-hermes.js 가 같은 일을 한다.
DROP INDEX IF EXISTS "npcs_channel_profile_idx";--> statement-breakpoint
ALTER TABLE "npcs" DROP CONSTRAINT IF EXISTS "npcs_hermes_profile_id_hermes_profiles_id_fk";--> statement-breakpoint
ALTER TABLE "npcs" DROP COLUMN IF EXISTS "hermes_profile_id";--> statement-breakpoint
DROP TABLE IF EXISTS "approval_targets" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "approvals" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "npc_panel_reads" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "channel_subprojects" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "channel_projects" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "cron_job_origins" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "channel_kanban_boards" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "channel_gateway_bindings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "hermes_profiles" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "gateway_shares" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "gateway_resources" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "provider_shares" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "provider_resources" CASCADE;
