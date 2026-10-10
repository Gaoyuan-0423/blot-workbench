import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";

const database = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("idb-keyval", () => database);

import { createExampleProject, loadProject, saveProject } from "./index";
import type { Project } from "./types";

let example: Project, stored: unknown;
beforeAll(async () => {
  if (!globalThis.crypto?.subtle)
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
  example = await createExampleProject();
});
beforeEach(() => {
  stored = undefined;
  database.get.mockReset();
  database.set.mockReset();
  database.get.mockImplementation(async () => stored);
  database.set.mockImplementation(async (_key: string, value: unknown) => {
    stored = structuredClone(value);
  });
});

describe("serialized project persistence", () => {
  it("writes immutable snapshots in call order and waits for queued saves before loading", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    database.set.mockImplementationOnce(
      async (_key: string, value: unknown) => {
        await firstGate;
        stored = structuredClone(value);
      },
    );
    const first = structuredClone(example);
    first.name = "First snapshot";
    const firstSave = saveProject(first);
    first.name = "Mutation after calling save";
    const second = structuredClone(example);
    second.name = "Second snapshot";
    const secondSave = saveProject(second),
      loading = loadProject();
    await vi.waitFor(() => expect(database.set).toHaveBeenCalledTimes(1));
    expect(database.set.mock.calls[0][1].name).toBe("First snapshot");
    expect(database.get).not.toHaveBeenCalled();
    releaseFirst!();
    await Promise.all([firstSave, secondSave]);
    expect((await loading)?.name).toBe("Second snapshot");
    expect(database.set).toHaveBeenCalledTimes(2);
  });
  it("reports a failed write without poisoning subsequent saves", async () => {
    database.set.mockRejectedValueOnce(new Error("Storage full"));
    await expect(saveProject(example)).rejects.toThrow("Storage full");
    const recovered = structuredClone(example);
    recovered.name = "Retry succeeded";
    await saveProject(recovered);
    expect((await loadProject())?.name).toBe("Retry succeeded");
  });
  it("rejects damaged persisted state rather than accepting a false confirmed result", async () => {
    stored = structuredClone(example);
    const corrupted = stored as Project;
    corrupted.analyses[0].status = "confirmed";
    corrupted.analyses[0].rois[0].rect.x += 1;
    await expect(loadProject()).rejects.toThrow(/Confirmed analysis/);
  });
});
