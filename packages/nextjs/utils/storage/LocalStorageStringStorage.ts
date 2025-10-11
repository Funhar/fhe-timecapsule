import { GenericStringStorage } from "fhevm-sdk";

/**
 * Generic string storage implementation backed by browser localStorage.
 * Falls back to in-memory storage if localStorage is not accessible.
 */
export class LocalStorageStringStorage implements GenericStringStorage {
  #prefix: string;
  #memoryFallback: Map<string, string>;
  #isLocalStorageAvailable: boolean | null;

  constructor(prefix = "fhevm") {
    this.#prefix = prefix;
    this.#memoryFallback = new Map<string, string>();
    this.#isLocalStorageAvailable = null;
  }

  #buildKey(key: string) {
    return `${this.#prefix}:${key}`;
  }

  #hasLocalStorage(): boolean {
    if (this.#isLocalStorageAvailable !== null) {
      return this.#isLocalStorageAvailable;
    }

    if (typeof window === "undefined") return false;
    try {
      const testKey = "__storage_test__";
      window.localStorage.setItem(testKey, testKey);
      window.localStorage.removeItem(testKey);
      this.#isLocalStorageAvailable = true;
      return true;
    } catch {
      this.#isLocalStorageAvailable = false;
      return false;
    }
  }

  getItem(key: string): string | null {
    const storageKey = this.#buildKey(key);
    if (this.#hasLocalStorage()) {
      try {
        return window.localStorage.getItem(storageKey);
      } catch (error) {
        console.warn("LocalStorageStringStorage#getItem failed, falling back to memory store.", error);
      }
    }
    return this.#memoryFallback.get(storageKey) ?? null;
  }

  setItem(key: string, value: string): void {
    const storageKey = this.#buildKey(key);
    if (this.#hasLocalStorage()) {
      try {
        window.localStorage.setItem(storageKey, value);
        return;
      } catch (error) {
        console.warn("LocalStorageStringStorage#setItem failed, storing in memory instead.", error);
      }
    }
    this.#memoryFallback.set(storageKey, value);
  }

  removeItem(key: string): void {
    const storageKey = this.#buildKey(key);
    if (this.#hasLocalStorage()) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch (error) {
        console.warn("LocalStorageStringStorage#removeItem failed, clearing from memory instead.", error);
      }
    }
    this.#memoryFallback.delete(storageKey);
  }
}
