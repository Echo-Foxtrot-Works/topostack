import type { GeometryWarning } from "@topostack/core";
import { hasMessage, t } from "$lib/i18n/i18n.svelte";

/**
 * A generation warning in the studio's language: its catalog message when
 * core gave it a `messageKey`, else core's English text. Every warning core
 * emits has a key (packages/core warning-keys test); the English fallback
 * only covers geometry saved before keys existed.
 */
export function warningText(warning: Pick<GeometryWarning, "message" | "messageKey" | "params">): string {
  const key = warning.messageKey ? `warnings.${warning.messageKey}` : undefined;
  return key && hasMessage(key) ? t(key, warning.params) : warning.message;
}
