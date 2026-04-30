import { describe, it, expect, beforeEach } from "vitest";
import { RoomSSEController } from "../api/RoomSSEController.js";

describe("RoomSSEController", () => {
  let controller: RoomSSEController;

  beforeEach(() => {
    controller = new RoomSSEController();
  });

  it("registers a client and returns clientId", () => {
    const clientId = controller.registerClient("room-1");
    expect(clientId).toBeDefined();
    expect(clientId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("broadcasts message event to registered clients of the same room", async () => {
    const clientId = controller.registerClient("room-1");
    const events: any[] = [];
    controller.onEvent(clientId, (event) => events.push(event));

    controller.broadcast("room-1", {
      event: "message",
      data: { id: "msg-1", type: "human", sender: "user", content: "Hello" },
    });

    expect(events.length).toBe(1);
    expect(events[0].event).toBe("message");
    expect(events[0].data.content).toBe("Hello");
  });

  it("does not broadcast to clients of other rooms", () => {
    const clientA = controller.registerClient("room-1");
    const clientB = controller.registerClient("room-2");
    const eventsB: any[] = [];
    controller.onEvent(clientB, (event) => eventsB.push(event));

    controller.broadcast("room-1", {
      event: "message",
      data: { content: "Hello" },
    });

    expect(eventsB.length).toBe(0);
  });

  it("unregisters a client", () => {
    const clientId = controller.registerClient("room-1");
    const events: any[] = [];
    controller.onEvent(clientId, (event) => events.push(event));
    controller.unregisterClient(clientId);

    controller.broadcast("room-1", {
      event: "message",
      data: { content: "Test" },
    });

    expect(events.length).toBe(0);
  });

  it("supports multiple event types", () => {
    const clientId = controller.registerClient("room-1");
    const events: any[] = [];
    controller.onEvent(clientId, (event) => events.push(event));

    controller.broadcast("room-1", { event: "state_change", data: { from: "IDLE", to: "CONSENSUS" } });
    controller.broadcast("room-1", { event: "task_update", data: { issueId: "i-1", status: "worker_started" } });
    controller.broadcast("room-1", { event: "error", data: { code: "WORKER_CRASHED", message: "Crash" } });

    expect(events.map(e => e.event)).toEqual(["state_change", "task_update", "error"]);
  });

  it("broadcastStateChange emits state_change event", () => {
    const clientId = controller.registerClient("room-1");
    const events: any[] = [];
    controller.onEvent(clientId, (event) => events.push(event));

    controller.broadcastStateChange("room-1", "IDLE", "CONSENSUS");

    expect(events.length).toBe(1);
    expect(events[0].event).toBe("state_change");
    expect(events[0].data).toEqual({ from: "IDLE", to: "CONSENSUS" });
  });

  it("broadcastMessage emits message event", () => {
    const clientId = controller.registerClient("room-1");
    const events: any[] = [];
    controller.onEvent(clientId, (event) => events.push(event));

    controller.broadcastMessage("room-1", { id: "msg-1", type: "human", content: "Hi" });

    expect(events.length).toBe(1);
    expect(events[0].event).toBe("message");
    expect(events[0].data.id).toBe("msg-1");
  });

  it("getClientCount returns correct count per room", () => {
    controller.registerClient("room-1");
    controller.registerClient("room-1");
    controller.registerClient("room-2");

    expect(controller.getClientCount("room-1")).toBe(2);
    expect(controller.getClientCount("room-2")).toBe(1);
    expect(controller.getClientCount("room-3")).toBe(0);
  });

  it("emits client_registered and client_unregistered events", () => {
    const registered: any[] = [];
    const unregistered: any[] = [];
    controller.on("client_registered", (data) => registered.push(data));
    controller.on("client_unregistered", (data) => unregistered.push(data));

    const clientId = controller.registerClient("room-1");
    expect(registered.length).toBe(1);
    expect(registered[0].clientId).toBe(clientId);

    controller.unregisterClient(clientId);
    expect(unregistered.length).toBe(1);
    expect(unregistered[0].clientId).toBe(clientId);
  });

  it("onEvent with unknown clientId does nothing", () => {
    // Should not throw, just silently no-op
    controller.onEvent("nonexistent", () => expect.unreachable("should not be called"));
    controller.broadcast("room-1", { event: "message", data: {} });
  });
});
