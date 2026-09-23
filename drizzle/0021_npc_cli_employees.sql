-- crew-office: Hermes 프로필 없는 Claude Code·Codex CLI 직원을 허용한다. 제약을 푸는 것뿐이라 기존 행은 그대로다.
-- SQLite 쪽은 src/db/sqlite-npc-cli-employees.js 가 같은 일을 한다.
ALTER TABLE "npcs" ALTER COLUMN "hermes_profile_id" DROP NOT NULL;
