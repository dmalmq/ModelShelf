// One deterministic, revision-scoped mapping from an IFC express ID to an opaque
// ObjectRef.objectId. See ../../../schemas/model/v1/README.md for the full contract
// this must agree with (the Python worker and Rust crate implement the same function).
// Runs in Node tests, the Next bundle, and the IFC worker via globalThis.crypto.subtle.

export async function expressIdToObjectId(revisionId: string, expressId: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${revisionId}:${expressId}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `occ_${hex.slice(0, 16)}`;
}
