import type { ExportBlock, GeometryWarning } from "@topostack/core";
import type { MessageParams } from "$lib/i18n/format";
import { hasMessage, t } from "$lib/i18n/i18n.svelte";
import type { MessageKey } from "$lib/i18n/messages/en/index";

type Keyed = Pick<GeometryWarning, "message" | "messageKey" | "params">;

/** Airspace class ids core passes as `airspaceClasses`, named in the studio's language. */
function localParams(params: Keyed["params"]): MessageParams | undefined {
  const classes = params?.airspaceClasses;
  if (!Array.isArray(classes)) return params;
  return { ...params, airspaceClasses: classes.map((id) => (hasMessage(`warnings.airspaceClass.${id}`) ? t(`warnings.airspaceClass.${id}` as MessageKey) : id)) };
}

/**
 * A generation warning in the studio's language: its catalog message when
 * core gave it a `messageKey`, else core's English text. Every warning core
 * emits has a key (packages/core warning-keys test); the English fallback
 * only covers geometry saved before keys existed.
 */
export function warningText(warning: Keyed): string {
  const name = warning.messageKey;
  return name && hasMessage(`warnings.${name}`) ? t(`warnings.${name}` as MessageKey, localParams(warning.params)) : warning.message;
}

/** Why export is blocked (`exportBlockMessage` from core), in the studio's language. */
export function exportBlockText(block: ExportBlock): string;
export function exportBlockText(block: ExportBlock | undefined): string | undefined;
export function exportBlockText(block: ExportBlock | undefined): string | undefined {
  return block && warningText(block);
}
