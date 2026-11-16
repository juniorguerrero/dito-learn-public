import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLatestValueSaver, SaveStatus, SendResult } from "@/lib/progressSaver";

// A controllable fake server: each send() returns a promise we resolve by hand.
function fakeServer() {
  const calls: { value: number; keepalive: boolean; resolve: (r: SendResult) => void; reject: (e: unknown) => void }[] = [];
  const send = (value: number, { keepalive }: { keepalive: boolean }) =>
    new Promise<SendResult>((resolve, reject) => calls.push({ value, keepalive, resolve, reject }));
  return { calls, send };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("createLatestValueSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces a burst of changes into a single save of the latest value", async () => {
    const srv = fakeServer();
    const statuses: SaveStatus[] = [];
    const saver = createLatestValueSaver({ send: srv.send, debounceMs: 400, onStatus: (s) => statuses.push(s) });

    saver.schedule(1);
    saver.schedule(2);
    saver.schedule(3);
    await vi.advanceTimersByTimeAsync(399);
    expect(srv.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(srv.calls.map((c) => c.value)).toEqual([3]);

    srv.calls[0].resolve("ok");
    await settle();
    expect(statuses).toEqual(["saving", "saved"]);
  });

  it("keeps one request in flight so saves reach the server in order", async () => {
    const srv = fakeServer();
    const saver = createLatestValueSaver({ send: srv.send, debounceMs: 10 });

    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(10);
    saver.schedule(2);
    saver.schedule(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(srv.calls.map((c) => c.value)).toEqual([1]); // 2/3 wait for 1 to finish

    srv.calls[0].resolve("ok");
    await settle();
    expect(srv.calls.map((c) => c.value)).toEqual([1, 3]); // newest only, after the first
  });

  it("retries transient failures and then gives up with an error status", async () => {
    const srv = fakeServer();
    const statuses: SaveStatus[] = [];
    const saver = createLatestValueSaver({ send: srv.send, debounceMs: 10, retryMs: 50, maxRetries: 2, onStatus: (s) => statuses.push(s) });

    saver.schedule(7);
    await vi.advanceTimersByTimeAsync(10);
    srv.calls[0].reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(50);
    srv.calls[1].resolve("retry"); // 5xx
    await vi.advanceTimersByTimeAsync(50);
    srv.calls[2].reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(500);

    expect(srv.calls.map((c) => c.value)).toEqual([7, 7, 7]);
    expect(statuses.at(-1)).toBe("error");

    // The next change retries with the newest value.
    saver.schedule(8);
    await vi.advanceTimersByTimeAsync(10);
    expect(srv.calls.at(-1)!.value).toBe(8);
  });

  it("does not retry permanent rejections", async () => {
    const srv = fakeServer();
    const saver = createLatestValueSaver({ send: srv.send, debounceMs: 10, retryMs: 10 });
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(10);
    srv.calls[0].resolve("drop");
    await vi.advanceTimersByTimeAsync(1000);
    expect(srv.calls).toHaveLength(1);
  });

  it("flushOnExit sends unsaved changes with keepalive, and a failing older request never resurrects", async () => {
    const srv = fakeServer();
    const saver = createLatestValueSaver({ send: srv.send, debounceMs: 10, retryMs: 10 });

    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(10); // 1 in flight
    saver.schedule(2); // waiting behind 1
    saver.flushOnExit(); // tab hidden: 2 goes out immediately
    expect(srv.calls.map((c) => [c.value, c.keepalive])).toEqual([[1, false], [2, true]]);

    srv.calls[0].reject(new Error("offline")); // the *older* request fails
    await vi.advanceTimersByTimeAsync(1000);
    expect(srv.calls.map((c) => c.value)).toEqual([1, 2]); // 1 is not retried over 2
  });

  it("flushOnExit re-sends the latest snapshot if it is still in flight (unload may cancel it)", async () => {
    const srv = fakeServer();
    const saver = createLatestValueSaver({ send: srv.send, debounceMs: 10 });
    saver.schedule(5);
    await vi.advanceTimersByTimeAsync(10); // 5 in flight, nothing pending
    saver.flushOnExit();
    expect(srv.calls.map((c) => [c.value, c.keepalive])).toEqual([[5, false], [5, true]]);
  });

  it("flushOnExit is a no-op when everything is saved", async () => {
    const srv = fakeServer();
    const saver = createLatestValueSaver({ send: srv.send, debounceMs: 10 });
    saver.flushOnExit();
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(10);
    srv.calls[0].resolve("ok");
    await settle();
    saver.flushOnExit();
    expect(srv.calls).toHaveLength(1);
  });
});
