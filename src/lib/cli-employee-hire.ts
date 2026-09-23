// crew-office: CLI 직원을 채널에 고용한다. 규칙(검증)은 cli-employees.ts, 여기는 저장만 한다.

import { db, npcs, nowForDb, jsonForDb } from "@/db";
import type { CliEmployeeInput } from "./cli-employees";
import { placeUnplacedNpcs } from "./npc-seating";

/**
 * 프로필 없는 NPC 행을 만들고, Hermes 고용과 같은 방식으로 빈 데스크 좌석에 앉힌다.
 * 모델은 adapter_config.model(소켓 핸들러가 읽는 자리), 인격은 agent_config.soul 에 둔다.
 */
export async function hireCliEmployee(
  channelId: string,
  input: CliEmployeeInput,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(npcs)
    .values({
      channelId,
      name: input.name,
      appearance: jsonForDb(input.appearance) as typeof npcs.$inferInsert.appearance,
      adapterType: input.adapterType,
      adapterConfig: jsonForDb(
        input.model ? { model: input.model } : {},
      ) as typeof npcs.$inferInsert.adapterConfig,
      agentConfig: jsonForDb(
        input.soul ? { soul: input.soul } : {},
      ) as typeof npcs.$inferInsert.agentConfig,
      hermesProfileId: null,
      active: true,
      updatedAt: nowForDb(),
    })
    .returning({ id: npcs.id });
  await placeUnplacedNpcs(channelId);
  return { id: row.id };
}
