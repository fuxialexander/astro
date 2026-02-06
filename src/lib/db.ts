import { get, set } from "idb-keyval"

export async function loadState<T>(key: string): Promise<T | undefined> {
  return get<T>(key)
}

export async function saveState<T>(key: string, value: T): Promise<void> {
  await set(key, value)
}
