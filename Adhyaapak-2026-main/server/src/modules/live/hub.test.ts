import { describe, expect, it, vi } from "vitest";
import { publish, subscribe, watcherCount } from "./hub";

describe("live hub", () => {
  it("tells only the watchers of that class, and stops after unsubscribe", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribe("class-a", a);
    subscribe("class-b", b);
    publish("class-a", { kind: "answers", assessmentId: "x" });
    expect(a).toHaveBeenCalledWith({ kind: "answers", assessmentId: "x" });
    expect(b).not.toHaveBeenCalled();
    offA();
    publish("class-a", { kind: "closed" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(watcherCount("class-a")).toBe(0);
  });

  it("keeps going when one listener throws", () => {
    const good = vi.fn();
    subscribe("class-c", () => {
      throw new Error("dead connection");
    });
    subscribe("class-c", good);
    expect(() => publish("class-c", { kind: "opened" })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
