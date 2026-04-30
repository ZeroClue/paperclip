import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

export interface SSEPayload {
  event: string;
  data: unknown;
}

type ClientCallback = (payload: SSEPayload) => void;

interface Client {
  roomId: string;
  callback: ClientCallback;
}

export class RoomSSEController extends EventEmitter {
  private clients: Map<string, Client> = new Map();

  registerClient(roomId: string): string {
    const clientId = randomUUID();
    this.clients.set(clientId, { roomId, callback: () => {} });
    this.emit("client_registered", { clientId, roomId });
    return clientId;
  }

  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
    this.emit("client_unregistered", { clientId });
  }

  onEvent(clientId: string, callback: ClientCallback): void {
    const client = this.clients.get(clientId);
    if (client) client.callback = callback;
  }

  broadcast(roomId: string, payload: SSEPayload): void {
    for (const [clientId, client] of this.clients) {
      if (client.roomId === roomId) {
        client.callback(payload);
      }
    }
  }

  broadcastStateChange(roomId: string, from: string, to: string): void {
    this.broadcast(roomId, { event: "state_change", data: { from, to } });
  }

  broadcastMessage(roomId: string, message: unknown): void {
    this.broadcast(roomId, { event: "message", data: message });
  }

  getClientCount(roomId: string): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.roomId === roomId) count++;
    }
    return count;
  }
}
