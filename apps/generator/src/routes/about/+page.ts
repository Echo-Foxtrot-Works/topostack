import { basePath } from "$lib/site/paths";
import { redirect } from "@sveltejs/kit";

export function load() {
  redirect(308, `${basePath()}/`);
}
