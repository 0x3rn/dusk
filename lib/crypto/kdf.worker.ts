// lib/crypto/kdf.worker.ts
// Entry point of the key-derivation Web Worker. Loaded by kdf-client.ts with
// `new Worker(new URL("./kdf.worker.ts", import.meta.url))`. All logic lives in
// kdf-worker-core.ts; this file only connects it to postMessage.
import { KDF_WORKER_READY, handleKdfWorkerMessage, type KdfWorkerReply } from "./kdf-worker-core";

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: KdfWorkerReply, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<unknown>) => {
  void handleKdfWorkerMessage(event.data).then((handled) => {
    if (handled) scope.postMessage(handled.reply, handled.transfer);
  });
};

scope.postMessage(KDF_WORKER_READY, []);
