import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// Vite's own 5173 collides with just about every other JS dev server, so the
// generator claims a quieter default. TOPOSTACK_WEB_PORT overrides it, and the
// root `npm run dev` sets that variable when it has to move off the default.
const siteEnvironment = process.env.VITE_SITE_ENV ?? "development";
if (!["production", "development", "atomm"].includes(siteEnvironment)) throw new Error("VITE_SITE_ENV must be production, development, or atomm.");
const DEFAULT_WEB_PORT = 5273;
const requestedWebPort = Number(process.env.TOPOSTACK_WEB_PORT);
const webPort = Number.isInteger(requestedWebPort) && requestedWebPort > 0 && requestedWebPort <= 65_535 ? requestedWebPort : DEFAULT_WEB_PORT;

export default defineConfig({
  plugins: [sveltekit()],
  // Keep Vite and the post-build header policy on the same explicit environment.
  define: { "import.meta.env.VITE_SITE_ENV": JSON.stringify(siteEnvironment) },
  server: { port: webPort, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Emit the global theme once, even when shared JS differs by route.
            { name: "theme-styles", test: /node_modules\/@loidolt\/.*\.css(?:\?|$)/, priority: 50 },
            { name: "three", test: /node_modules\/three/, priority: 40 },
            { name: "maplibre", test: /node_modules\/maplibre-gl/, priority: 40 },
            // Split by consumer, so the homepage does not load UI code only the
            // studio uses (the settings rail's tabs and their roving focus).
            { name: "ui", test: /node_modules\/(?:@lucide\/svelte|svelte|bits-ui)/, priority: 30, entriesAware: true },
            // The geometry engine is many small modules that the studio, its worker,
            // and the packaging code import in different subsets. Left to itself
            // the bundler splits them per consumer, which costs more in chunk
            // overhead and lost gzip context than it saves. Keep the generation
            // path in one chunk; export/ is only needed once a project is packaged.
            // The project parser serves saved, imported and shared projects, and
            // the agent request contract only the lazily loaded WebMCP tools, so
            // they stay with their importers rather than in this startup chunk.
            // The airspace stage is loaded only by projects that build airspace.
            { name: "core", test: /\/packages\/core\/src\/(?!export\/|project\/(?:parse|request|schema|plan)\.ts|airspace\.ts|pipeline\/airspace-(?:stack|supports)\.ts)|node_modules\/(?:polygon-clipping|d3-contour|clipper-lib)/, priority: 25 },
            // Capture shared site dependencies before guides so the homepage
            // never needs the guide content chunk. Split shared JS by actual
            // consumers to avoid loading guide-only navigation on the homepage.
            { name: "site", test: /node_modules\/(?:@loidolt\/|@sveltejs\/kit\/)|\/src\/lib\/site\/(?:SiteHeader\.svelte|SiteFooter\.svelte|FeedbackButton\.svelte|WaterFinishComparison\.svelte|theme\.ts|seo\.ts|support\.ts)$/, priority: 20, entriesAware: true },
            { name: "guides", test: /\/src\/routes\/(?:guides(?:\/.*)?|examples\/[^/]+|privacy|changelog)\/\+page\.svelte$|\/src\/lib\/site\/ChangelogGroups\.svelte$/, priority: 10 },
          ],
        },
      },
    },
  },
});
