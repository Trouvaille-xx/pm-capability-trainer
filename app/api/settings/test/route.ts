import { handle, ok } from "@/lib/api";
import { testConnection } from "@/lib/ai";

export const dynamic = "force-dynamic";

/** 用当前配置发一条极小请求，确认端点、密钥、模型名都可用。 */
export async function POST() {
  return handle(async () => {
    const result = await testConnection();
    return ok(result);
  });
}
