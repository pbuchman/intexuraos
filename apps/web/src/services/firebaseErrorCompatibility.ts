import { FirebaseError } from 'firebase/app';

/** Keep Firebase error construction working when the host hardens Error.prototype. */
export function ensureFirebaseErrorNameCompatibility(): void {
  const firebaseNameDescriptor = Object.getOwnPropertyDescriptor(
    FirebaseError.prototype,
    'name',
  );
  if (firebaseNameDescriptor?.writable === true) return;

  const errorNameDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name');
  if (errorNameDescriptor?.writable !== false) return;

  Object.defineProperty(FirebaseError.prototype, 'name', {
    configurable: true,
    enumerable: false,
    value: 'FirebaseError',
    writable: true,
  });
}

ensureFirebaseErrorNameCompatibility();
