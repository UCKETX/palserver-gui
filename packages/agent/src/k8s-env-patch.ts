import * as k8s from "@kubernetes/client-node";
import type { WorldSettings } from "@palserver/shared";
import type { InstanceRecord } from "./store.js";
import { loadKubeConfig } from "./k8s.js";
import { INI_TO_ENV, settingsToEnvPatch } from "./env-mapping.js";

/** middleware：注入 RFC 6902 JSON-Patch content-type。
 * @kubernetes/client-node 的第二參數是 ConfigurationOptions（無 headers 欄位），
 * 必須透過 middleware 的 setHeaderParam 才能正確設定 Content-Type。
 *
 * 1.4.0 的 mergeMap 對 callback 結果呼叫 .toPromise()，裸 Promise 沒有此方法；
 * 回傳 Observable-like（帶 toPromise）即可相容。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonPatchMiddleware(): any {
  const of = (value: unknown) => ({ toPromise: () => Promise.resolve(value) });
  return {
    pre: (ctx: { setHeaderParam: (k: string, v: string) => void }) => {
      ctx.setHeaderParam("Content-Type", "application/json-patch+json");
      return of(ctx);
    },
    post: (ctx: unknown) => of(ctx),
  };
}

/**
 * k8s：把世界設定變更以 env patch 方式套用到 StatefulSet（讀改寫模式）。
 *
 * 移植自 PalworldManager 的 applyEnvPatchK8s（settings.ts 第 119-172 行）。
 * 流程：
 *   1. settingsToEnvPatch 把 WorldSettings 鍵轉成 thijsvanloef env 名稱
 *   2. 讀取現有 StatefulSet 的完整 env 陣列
 *   3. 找到對應項替換值（找不到則新增；Secret-backed valueFrom 保留並回報 unsupported）
 *   4. 用 RFC 6902 JSON Patch 寫回完整 env 陣列，觸發 Pod 重建
 *
 * 回傳 unsupported：WorldSettings 裡 thijsvanloef 不支援、無對應 env 的鍵清單。
 */
export async function applyEnvPatchK8s(
  rec: InstanceRecord,
  changes: Partial<WorldSettings>,
): Promise<{ unsupported: string[]; applied: string[] }> {
  const { envPatch, unsupported } = settingsToEnvPatch(changes);
  const keyByEnv = new Map(Object.entries(INI_TO_ENV).map(([key, env]) => [env, key]));

  // 沒有任何可對應的 env 就不必打 API —— 仍回報不支援的鍵。
  if (Object.keys(envPatch).length === 0) {
    return { unsupported, applied: [] };
  }

  const kc = loadKubeConfig();
  const appsApi = kc.makeApiClient(k8s.AppsV1Api);

  // 1. 讀取現有 StatefulSet
  const sts = await appsApi.readNamespacedStatefulSet({
    name: rec.k8sStatefulSet!,
    namespace: rec.k8sNamespace!,
  });

  const containers = sts.spec?.template?.spec?.containers ?? [];
  const containerIndex = Math.max(0, containers.findIndex((item) => item.name === "palworld-server"));
  const container = containers[containerIndex];
  if (!container) throw new Error("找不到 game-server 容器定義");

  // 複製一份現有 env 再改（避免改到 k8s client 快取的物件）
  const existingEnv = (container.env ?? []).map((e) => ({ ...e }));

  // 2. 讀改寫：找到對應項替換，找不到則新增
  const applied: string[] = [];
  for (const [envName, envValue] of Object.entries(envPatch)) {
    const idx = existingEnv.findIndex((e) => e.name === envName);
    if (idx >= 0) {
      if (existingEnv[idx].valueFrom) {
        unsupported.push(keyByEnv.get(envName) ?? envName);
        continue;
      }
      existingEnv[idx] = { ...existingEnv[idx], name: envName, value: envValue };
    } else {
      existingEnv.push({ name: envName, value: envValue });
    }
    applied.push(keyByEnv.get(envName) ?? envName);
  }

  if (applied.length === 0) return { unsupported, applied };

  // 3. 用 RFC 6902 JSON Patch 寫回完整 env 陣列
  const jsonPatch = [
    {
      op: container.env ? "replace" : "add",
      path: `/spec/template/spec/containers/${containerIndex}/env`,
      value: existingEnv,
    },
  ];

  await appsApi.patchNamespacedStatefulSet(
    {
      name: rec.k8sStatefulSet!,
      namespace: rec.k8sNamespace!,
      body: jsonPatch,
    },
    {
      middleware: [jsonPatchMiddleware()],
    } as unknown as k8s.Configuration,
  );

  const readBack = await appsApi.readNamespacedStatefulSet({
    name: rec.k8sStatefulSet!,
    namespace: rec.k8sNamespace!,
  });
  const readBackContainer = readBack.spec?.template?.spec?.containers?.[containerIndex];
  const readBackEnv = new Map((readBackContainer?.env ?? []).map((entry) => [entry.name, entry]));
  for (const iniKey of applied) {
    const envName = INI_TO_ENV[iniKey];
    if (readBackEnv.get(envName)?.value !== envPatch[envName]) {
      throw new Error(`k8s 設定寫回驗證失敗：${envName}`);
    }
  }

  return { unsupported, applied };
}
