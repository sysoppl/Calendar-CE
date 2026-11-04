// Runs Argon2id off the main thread: 64 MiB and three passes take a fifth of
// a second on a laptop and far longer on a slow phone, enough to freeze the
// interface. One request per worker; the page ends the worker after the
// reply, which also gives the memory back.
import { argon2idRaw, type Argon2Reply, type Argon2Request } from './argon2';
import { wipe } from './encoding';

// The project compiles against the DOM library, where `self` is a window, so
// the part of the worker scope used here is described by hand.
interface WorkerScope {
  onmessage: ((event: MessageEvent<Argon2Request>) => void) | null;
  postMessage(message: Argon2Reply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { password, salt } = event.data;
  argon2idRaw(password, salt)
    // Transferred, not copied: no second copy of the key stays behind here.
    .then((hash) => scope.postMessage({ hash }, [hash.buffer]))
    .catch(() => scope.postMessage({}))
    .finally(() => wipe(password));
};
