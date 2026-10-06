import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 of bytes or a string. */
export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
