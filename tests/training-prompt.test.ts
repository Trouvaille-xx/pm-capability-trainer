import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Capture, MethodologyCard, TrainingSession } from "@/lib/types";

/**
 * 训练提示词的联动注入。
 *
 * 这一条打通的是「读书 → 训练」：关联的记录要作为素材进去，
 * 选中的方法论卡片要作为可调用框架进去。之前这两个模块在训练中完全没被用过。
 *
 * 会真的读文件，所以要先把 PM_TRAINER_DATA_DIR 指到临时目录再动态 import。
 */
let dir: string;
let prompts: typeof import("@/lib/prompts");

function makeSession(partial: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: "s1",
    scenario: "product-teardown",
    mode: "assistant",
    topic: "拆解某产品的定价页",
    status: "active",
    transcript: [],
    submission: "",
    currentStep: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pm-trainer-prompt-"));

  const capture: Capture = {
    id: "cap-1",
    kind: "book",
    title: "《影响力》",
    author: "西奥迪尼",
    source: "",
    status: "done",
    tags: [],
    summary: "讲了六种说服原理",
    keyPoints: ["互惠", "承诺与一致"],
    thoughts: "可以用在定价页的设计上",
    rating: 5,
    domains: ["心理学"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const card: MethodologyCard = {
    id: "mth-1",
    domain: "心理学",
    title: "损失厌恶",
    oneLiner: "人对失去的敏感度远高于对获得的",
    detail: "",
    howToUse: "定价页强调不买的损失，而不是买到的好处",
    example: "",
    scenarios: ["product-teardown"],
    sourceCaptureIds: ["cap-1"],
    builtin: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  // 先把数据落盘，再让 store 用这个目录加载
  await writeFile(path.join(dir, "captures.json"), JSON.stringify([capture]), "utf8");
  await writeFile(path.join(dir, "methodology.json"), JSON.stringify([card]), "utf8");
  await writeFile(path.join(dir, "prompts.json"), JSON.stringify([]), "utf8");

  process.env.PM_TRAINER_DATA_DIR = dir;
  prompts = await import("@/lib/prompts");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("trainingSystemPrompt 的联动注入", () => {
  it("关联的记录会作为【本次输入素材】注入", async () => {
    const text = await prompts.trainingSystemPrompt(
      makeSession({ captureId: "cap-1" }),
    );

    expect(text).toContain("【本次输入素材】");
    expect(text).toContain("《影响力》");
    expect(text).toContain("讲了六种说服原理");
    expect(text).toContain("互惠");
    expect(text).toContain("可以用在定价页的设计上");
  });

  it("选中的方法论卡片会作为【可用方法论】注入", async () => {
    const text = await prompts.trainingSystemPrompt(
      makeSession({ methodologyCardIds: ["mth-1"] }),
    );

    expect(text).toContain("【可用方法论】");
    expect(text).toContain("损失厌恶");
    expect(text).toContain("人对失去的敏感度远高于对获得的");
    expect(text).toContain("定价页强调不买的损失");
  });

  it("没关联时两个块都不出现（不给模型塞空壳）", async () => {
    const text = await prompts.trainingSystemPrompt(makeSession());
    expect(text).not.toContain("【本次输入素材】");
    expect(text).not.toContain("【可用方法论】");
  });

  it("引用了已被删除的记录 / 卡片时静默跳过，不抛错", async () => {
    const text = await prompts.trainingSystemPrompt(
      makeSession({ captureId: "已被删除", methodologyCardIds: ["已被删除"] }),
    );
    expect(text).not.toContain("【本次输入素材】");
    expect(text).not.toContain("【可用方法论】");
    // 场景块仍然在，训练照常能跑
    expect(text).toContain("产品经理能力训练");
  });
});
