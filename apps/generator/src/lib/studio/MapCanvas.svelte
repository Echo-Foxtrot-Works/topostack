<script lang="ts">
  import { getEmbedded } from "$lib/studio/embed-context";
  import type { FeatureCollection } from "geojson";
  import { onMount, untrack } from "svelte";
  import { base } from "$app/paths";
  import { LocateFixed, MapPin, Spline } from "@lucide/svelte";
  import * as maplibregl from "maplibre-gl";
  import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
  import type { AddLayerObject, GeoJSONSource, GeoJSONSourceSpecification, Map as MapLibreMap, MapEventType, MapMouseEvent } from "maplibre-gl";
  import { boundsForProject, MAX_PROJECT_DIMENSION_MM, MERCATOR_MAX_LATITUDE, markerCenterForAnchor, markerIcon, markerPolygons, unwrapLongitude, type CustomLineFeatureV1, type GeoBounds, type GeoPoint, type MapMarkerV1, type ProjectConfigV1 } from "@topostack/core";
  import { polygonsPath } from "$lib/studio/svg-path";
  /** A tile or source error carries which one failed; a style error carries neither. */
  type MapErrorEvent = MapEventType["error"] & { sourceId?: string; tile?: unknown };
  /** Camera moves the studio makes pass this as event data, so they are not mistaken for the user's. */
  type MapMoveEndEvent = MapEventType["moveend"] & { topostackProgrammatic?: boolean };
  let { lakeSelection, onLakeViewportChange, onLakeMapClick, project, aspectLocked = $bindable(false), placingMarker = false, drawingLine = false, draftPoints = [], framing = true, hint = "Drag the map to choose your terrain", onLocationChange, onSelectionResize, onUnavailable, onPlaceMarker, onMoveMarker, onStopPlacing, onDrawPoint, onFinishDraw, onCancelDraw }: {
    lakeSelection?: { bounds?: GeoBounds; activeId?: string; lakes: { id: string; name: string; outline: [number, number][] }[] };
    onLakeViewportChange?: (bounds: GeoBounds) => void;
    onLakeMapClick?: (lat: number, lon: number, lakeId?: string) => void;
    aspectLocked?: boolean; project: ProjectConfigV1; onSelectionResize: (widthMm: number, heightMm: number, bounds: GeoBounds) => void; onUnavailable?: (reason?: "unsupported" | "load-failed") => void; onLocationChange: (lat: number, lon: number, zoom: number, bounds: GeoBounds) => void;
    /** While true, a click on the map places a marker there. */
    placingMarker?: boolean;
    /**
     * Whether this map chooses the terrain. Off, the selection guide, its
     * handles and the crosshair are put away and panning commits nothing:
     * placing a marker or drawing a path needs no map area, and a boundary
     * box that cannot be used is only in the way. The guide stays in the
     * layout, because the bounds a pan would report are measured from it.
     */
    framing?: boolean;
    /** What dragging the map does here. Panning always reframes the terrain,
        but choosing it is not why the custom data view shows this map. */
    hint?: string;
    onPlaceMarker?: (lat: number, lon: number) => void;
    /** While true, a click on the map adds a point to the path being drawn. */
    drawingLine?: boolean;
    /** The path so far, drawn over the map until it is finished. */
    draftPoints?: readonly GeoPoint[];
    onDrawPoint?: (lat: number, lon: number) => void;
    /** Ends the drawing. Closed, the path returns to its first point. */
    onFinishDraw?: (closed: boolean) => void;
    onCancelDraw?: () => void;
    /** Returns false when the dropped position was rejected, so the marker returns to its saved place. */
    onMoveMarker?: (id: string, lat: number, lon: number) => boolean;
    onStopPlacing?: () => void;
  } = $props();
  import AtommZoom from "$lib/atomm/AtommZoom.svelte";
  const isEmbedded = getEmbedded();
  let zoomScale = $state(1);
  let initialZoom = 10;
  let initialCenter: [number, number] = [0, 0];
  function setZoomScale(value: number) { map?.jumpTo({ zoom: initialZoom + Math.log2(value) }); }
  function resetMapView() { map?.jumpTo({ center: initialCenter, zoom: initialZoom }); }
  let container: HTMLDivElement;
  let guide: HTMLDivElement;
  let map: MapLibreMap | undefined;
  const mapMarkers = new Map<string, maplibregl.Marker>();
  const isCircle = $derived(project.cropShape === "circle");
  const CUSTOM_SOURCE_ID = "topostack-custom-lines";
  const AREA_SOURCE_ID = "topostack-map-area";
  const AREA_LAYER_ID = "topostack-map-area-outline";
  const DRAFT_SOURCE_ID = "topostack-line-draft";
  const DRAFT_LINE_LAYER_ID = "topostack-line-draft-line";
  const DRAFT_RUBBER_LAYER_ID = "topostack-line-draft-rubber";
  const DRAFT_POINT_LAYER_ID = "topostack-line-draft-points";
  /** How near the first point a click has to land to close the shape. */
  const CLOSE_RADIUS_PX = 14;
  const CUSTOM_TRAIL_LAYER_ID = "topostack-custom-trails";
  const CUSTOM_BOUNDARY_LAYER_ID = "topostack-custom-boundaries";
  const MARKER_SYMBOL_SIZE = 22;
  const MARKER_VIEWBOX_SIZE = 26;
  const MARKER_ELEMENT_SIZE_PX = 30;

  /**
   * Where the pointer is while a path is being drawn, so the segment it would
   * add is shown before the click. It snaps to the first point when clicking
   * there would close the shape, which is also how that is made visible.
   */
  let pointer = $state.raw<{ lat: number; lon: number } | undefined>(undefined);
  let closable = $state(false);
  /**
   * Whether the style is ready for sources and layers. `isStyleLoaded()` is
   * not the same question: it also reads false while tiles are still coming
   * in, which would silently drop an overlay update and leave the map showing
   * something the project no longer holds.
   *
   * It is set on the map's `load`, not `style.load`: overlays added between
   * the two, while the first tiles are still arriving, left WebKit on Linux
   * without the repaint that shows them, so the map stayed blank until moved.
   */
  let styleReady = $state(false);
  let resizing = $state(false);
  let skipSelectionFit = false;
  const handles = [
    { name: "top left", x: -1, y: -1 }, { name: "top", x: 0, y: -1 },
    { name: "top right", x: 1, y: -1 }, { name: "right", x: 1, y: 0 },
    { name: "bottom right", x: 1, y: 1 }, { name: "bottom", x: 0, y: 1 },
    { name: "bottom left", x: -1, y: 1 }, { name: "left", x: -1, y: 0 },
  ];
  let drag: { pointerId: number; x: number; y: number; width: number; height: number; widthMm: number; heightMm: number; handle: typeof handles[number] } | undefined;

  function startResize(event: PointerEvent, handle: typeof handles[number]): void {
    if (!map || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    map.stop();
    const rect = guide.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, widthMm: project.widthMm, heightMm: project.heightMm, handle };
    resizing = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveResize(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { width, height, handle, widthMm, heightMm } = drag;
    let sx = handle.x ? 1 + 2 * handle.x * (event.clientX - drag.x) / width : 1;
    let sy = handle.y ? 1 + 2 * handle.y * (event.clientY - drag.y) / height : 1;
    const maxX = Math.min((container.clientWidth - 32) / width, MAX_PROJECT_DIMENSION_MM / widthMm);
    const maxY = Math.min((container.clientHeight - 96) / height, MAX_PROJECT_DIMENSION_MM / heightMm);
    const minX = Math.min(1, 32 / width);
    const minY = Math.min(1, 32 / height);
    if (aspectLocked || event.shiftKey || isCircle) {
      // Project the pointer onto the aspect-ratio diagonal. Switching to the
      // axis with the largest delta jumps when one shrinks and the other grows.
      const scale = !handle.x ? sy : !handle.y ? sx : (sx * width * width + sy * height * height) / (width * width + height * height);
      sx = sy = Math.max(Math.max(minX, minY), Math.min(scale, maxX, maxY));
    } else {
      sx = Math.max(minX, Math.min(sx, maxX));
      sy = Math.max(minY, Math.min(sy, maxY));
    }
    guide.style.width = `${width * sx}px`;
    guide.style.height = `${height * sy}px`;
  }

  function finishResize(cancel = false): void {
    if (!drag || !map) return;
    const start = drag;
    drag = undefined;
    resizing = false;
    if (cancel) { guide.style.width = `${start.width}px`; guide.style.height = `${start.height}px`; return; }
    const rect = guide.getBoundingClientRect();
    if (Math.abs(rect.width - start.width) < 0.01 && Math.abs(rect.height - start.height) < 0.01) return;
    const origin = container.getBoundingClientRect();
    const nw = map.unproject([rect.left - origin.left, rect.top - origin.top]);
    const se = map.unproject([rect.right - origin.left, rect.bottom - origin.top]);
    const shift = project.location.lon - map.getCenter().lng;
    skipSelectionFit = true;
    onSelectionResize(start.widthMm * rect.width / start.width, start.heightMm * rect.height / start.height,
      { west: nw.lng + shift, east: se.lng + shift, north: nw.lat, south: se.lat });
  }

  function markerPixelOffset(marker: MapMarkerV1): [number, number] {
    const center = markerCenterForAnchor(marker, project.markerIcons, { x: 0, y: 0 }, MARKER_SYMBOL_SIZE);
    const scale = MARKER_ELEMENT_SIZE_PX / MARKER_VIEWBOX_SIZE;
    return [center.x * scale, center.y * scale];
  }

  const markerLabel = (marker: MapMarkerV1): string =>
    `${marker.name ? `${marker.name}, ` : ""}${markerIcon(marker, project.markerIcons)?.name ?? marker.symbol} marker at ${marker.lat.toFixed(5)}, ${marker.lon.toFixed(5)}`;

  /** What a marker's element draws; a change to it redraws the element. */
  function markerDrawingKey(marker: MapMarkerV1): string {
    const icon = markerIcon(marker, project.markerIcons);
    return icon ? `custom:${icon.id}:${icon.anchor ?? "center"}` : marker.symbol;
  }

  function markerElement(marker: MapMarkerV1): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "topostack-map-marker";
    element.dataset.symbol = marker.symbol;
    element.dataset.drawing = markerDrawingKey(marker);
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", markerLabel(marker));
    // Hovering a crowded map is the quickest way to tell markers apart.
    if (marker.name) element.title = marker.name;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-13 -13 26 26");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", polygonsPath(markerPolygons(marker, project.markerIcons, { x: 0, y: 0 }, MARKER_SYMBOL_SIZE)));
    path.setAttribute("fill-rule", "evenodd");
    svg.append(path);
    element.append(svg);
    return element;
  }

  const wrapLongitude = (lng: number): number => ((lng + 180) % 360 + 360) % 360 - 180;
  // Six decimals is about 0.1 m, far finer than a click or any engraving.
  const roundDegrees = (value: number): number => Math.round(value * 1e6) / 1e6;

  function addRenderedMarker(marker: MapMarkerV1, target: MapLibreMap): maplibregl.Marker {
    const draggable = Boolean(onMoveMarker);
    const rendered = new maplibregl.Marker({ element: markerElement(marker), anchor: "center", offset: markerPixelOffset(marker), draggable }).setLngLat([marker.lon, marker.lat]).addTo(target);
    if (draggable) {
      rendered.getElement().classList.add("topostack-map-marker--draggable");
      rendered.on("dragend", () => {
        const { lat, lng } = rendered.getLngLat();
        const current = project.markers.find((item) => item.id === marker.id);
        if (!onMoveMarker?.(marker.id, roundDegrees(lat), roundDegrees(wrapLongitude(lng))) && current) rendered.setLngLat([current.lon, current.lat]);
      });
    }
    return rendered;
  }

  function fitSelection(): void {
    if (!map || !guide || resizing) return;
    if (lakeSelection?.bounds) {
      const b = lakeSelection.bounds;
      map.resize({ topostackProgrammatic: true });
      map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 48, maxZoom: 15, duration: 0 }, { topostackProgrammatic: true });
      return;
    }
    const bounds = boundsForProject(project);
    const aspect = project.widthMm / project.heightMm;
    const width = Math.min(container.clientWidth * 0.54, 630, container.clientHeight * 0.7 * aspect);
    const height = width / aspect;
    if (!(width > 0 && height > 0)) return;
    guide.style.width = `${width}px`;
    guide.style.height = `${height}px`;
    map.resize({ topostackProgrammatic: true });
    map.fitBounds([[bounds.west, bounds.south], [bounds.east, bounds.north]], {
      padding: { left: (container.clientWidth - width) / 2, right: (container.clientWidth - width) / 2, top: (container.clientHeight - height) / 2, bottom: (container.clientHeight - height) / 2 },
      duration: 0, bearing: 0, pitch: 0,
    }, { topostackProgrammatic: true });
  }

  const longitudeWindow = () => project.location.bounds ?? { west: project.location.lon - 180, east: project.location.lon + 180, south: -MERCATOR_MAX_LATITUDE, north: MERCATOR_MAX_LATITUDE };

  function customLineData(lines: CustomLineFeatureV1[]) {
    const longitudeBounds = longitudeWindow();
    return {
      type: "FeatureCollection" as const,
      features: lines.map((line) => ({
        type: "Feature" as const,
        properties: { id: line.id, kind: line.kind },
        geometry: { type: "LineString" as const, coordinates: line.points.map((point) => [unwrapLongitude(point.lon, longitudeBounds), point.lat] as [number, number]) },
      })),
    };
  }

  /** Replace a GeoJSON source's data, or add the source and draw its layers (built only then) the first time. */
  function upsertGeoJson(target: MapLibreMap, id: string, data: GeoJSONSourceSpecification["data"], layers: () => AddLayerObject[], promoteId?: string): void {
    const source = target.getSource(id) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }
    target.addSource(id, { type: "geojson", data, ...(promoteId ? { promoteId } : {}) });
    for (const layer of layers()) target.addLayer(layer);
  }

  function syncCustomLines(lines: CustomLineFeatureV1[]): void {
    if (!map || !styleReady) return;
    upsertGeoJson(map, CUSTOM_SOURCE_ID, customLineData(lines), () => [{
      id: CUSTOM_BOUNDARY_LAYER_ID,
      type: "line",
      source: CUSTOM_SOURCE_ID,
      filter: ["==", ["get", "kind"], "boundary"],
      paint: { "line-color": "#75415d", "line-width": 3, "line-dasharray": [7, 4] },
      layout: { "line-cap": "round", "line-join": "round" },
    }, {
      id: CUSTOM_TRAIL_LAYER_ID,
      type: "line",
      source: CUSTOM_SOURCE_ID,
      filter: ["==", ["get", "kind"], "trail"],
      paint: { "line-color": "#b8682d", "line-width": 3, "line-dasharray": [3, 2] },
      layout: { "line-cap": "round", "line-join": "round" },
    }]);
  }

  /**
   * The project's map area as a line on the map, for views that do not frame
   * it. Markers and paths outside it are saved but not engraved, so a maker
   * placing them needs to see where it runs. A circle crop is the ellipse the
   * bounds hold.
   */
  function mapAreaData(show: boolean) {
    if (!show) return { type: "FeatureCollection" as const, features: [] };
    // The area generation uses, which exists even before a box was ever dragged.
    const { west, east, south, north } = boundsForProject(project);
    const ring: [number, number][] = project.cropShape === "circle"
      ? Array.from({ length: 73 }, (_, index) => {
        const angle = (2 * Math.PI * index) / 72;
        return [(west + east) / 2 + ((east - west) / 2) * Math.cos(angle), (south + north) / 2 + ((north - south) / 2) * Math.sin(angle)];
      })
      : [[west, north], [east, north], [east, south], [west, south], [west, north]];
    return { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: ring } }] };
  }

  function syncMapArea(show: boolean): void {
    if (!map || !styleReady) return;
    const data = mapAreaData(show);
    if (!map.getSource(AREA_SOURCE_ID) && !data.features.length) return;
    upsertGeoJson(map, AREA_SOURCE_ID, data, () => [{
      id: AREA_LAYER_ID,
      type: "line",
      source: AREA_SOURCE_ID,
      paint: { "line-color": "#20231d", "line-width": 2, "line-opacity": 0.7, "line-dasharray": [2, 2] },
    }]);
  }

  /**
   * The path being drawn: the line so far, a dot on every point of it, and the
   * segment the next click would add, running to the pointer.
   */
  function draftData(points: readonly GeoPoint[], to: { lat: number; lon: number } | undefined) {
    const longitudeBounds = longitudeWindow();
    const at = (point: { lat: number; lon: number }) => [unwrapLongitude(point.lon, longitudeBounds), point.lat] as [number, number];
    const coordinates = points.map(at);
    const last = coordinates[coordinates.length - 1];
    return {
      type: "FeatureCollection" as const,
      features: [
        ...(coordinates.length > 1 ? [{ type: "Feature" as const, properties: { rubber: false }, geometry: { type: "LineString" as const, coordinates } }] : []),
        ...(last && to ? [{ type: "Feature" as const, properties: { rubber: true }, geometry: { type: "LineString" as const, coordinates: [last, at(to)] } }] : []),
        // The first dot is drawn larger: it is the target that closes the shape.
        ...coordinates.map((coordinate, index) => ({ type: "Feature" as const, properties: { first: index === 0 }, geometry: { type: "Point" as const, coordinates: coordinate } })),
      ],
    };
  }

  function syncDraft(points: readonly GeoPoint[], to?: { lat: number; lon: number }): void {
    if (!map || !styleReady) return;
    if (!map.getSource(DRAFT_SOURCE_ID) && !points.length) return;
    upsertGeoJson(map, DRAFT_SOURCE_ID, draftData(points, to), () => [{
      id: DRAFT_LINE_LAYER_ID,
      type: "line",
      source: DRAFT_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["!", ["get", "rubber"]]],
      paint: { "line-color": "#b8682d", "line-width": 3, "line-dasharray": [2, 2] },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    // Thinner and paler: this segment is not placed until the next click.
    {
      id: DRAFT_RUBBER_LAYER_ID,
      type: "line",
      source: DRAFT_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["get", "rubber"]],
      paint: { "line-color": "#b8682d", "line-width": 2, "line-opacity": 0.6, "line-dasharray": [1, 2] },
      layout: { "line-cap": "round", "line-join": "round" },
    }, {
      id: DRAFT_POINT_LAYER_ID,
      type: "circle",
      source: DRAFT_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": ["case", ["get", "first"], 7, 4.5], "circle-color": "#ffffff", "circle-stroke-color": "#b8682d", "circle-stroke-width": 2 },
    }]);
  }

  /** True when a click at this screen point would close the shape. */
  function closesDraft(point: { x: number; y: number }): boolean {
    const first = draftPoints[0];
    if (!map || !first || draftPoints.length < 3) return false;
    const at = map.project([unwrapLongitude(first.lon, longitudeWindow()), first.lat]);
    return Math.hypot(at.x - point.x, at.y - point.y) <= CLOSE_RADIUS_PX;
  }

  let hoveredLake: string | number | undefined;
  function highlightLake(id?: string | number): void {
    if (!map) return;
    if (hoveredLake !== id) {
      if (hoveredLake !== undefined && map.getSource("chart-lakes")) map.setFeatureState({ source: "chart-lakes", id: hoveredLake }, { hover: false });
      hoveredLake = id;
      if (id !== undefined) map.setFeatureState({ source: "chart-lakes", id }, { hover: true });
    }
    map.getCanvas().style.cursor = id === undefined ? "" : "pointer";
  }

  onMount(() => {
    // MapLibre 6 needs an explicit worker URL with bundlers. Use Vite's worker
    // pipeline so the worker's shared-module imports are bundled for production.
    maplibregl.setWorkerUrl(mapWorkerUrl);
    try {
      map = new maplibregl.Map({ container, style: "https://tiles.openfreemap.org/styles/liberty", center: [project.location.lon, project.location.lat], zoom: project.location.zoom, attributionControl: false, cooperativeGestures: true, dragRotate: false, touchPitch: false, trackResize: false });
    } catch { onUnavailable?.("unsupported"); return; }
    map.touchZoomRotate.disableRotation();
    if (!isEmbedded()) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    initialZoom = map.getZoom(); initialCenter = [project.location.lon, project.location.lat];
    map.on("zoom", () => { if (map) zoomScale = 2 ** (map.getZoom() - initialZoom); });
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: `<a href="${base}/attribution${import.meta.env.VITE_SITE_ENV === "atomm" ? ".html" : ""}" target="_blank" rel="noopener noreferrer">All sources</a>` }), "bottom-left");
    let viewportTimer: ReturnType<typeof setTimeout> | undefined;
    let moveFrame = 0;
    const reportLakeViewport = () => {
      clearTimeout(viewportTimer);
      if (!onLakeViewportChange) return;
      viewportTimer = setTimeout(() => {
        if (!map) return;
        const bounds = map.getBounds();
        const centre = map.getCenter();
        const shift = wrapLongitude(centre.lng) - centre.lng;
        onLakeViewportChange?.({ west: bounds.getWest() + shift, east: bounds.getEast() + shift, south: Math.max(-85, bounds.getSouth()), north: Math.min(85, bounds.getNorth()) });
      }, 180);
    };
    map.on("load", () => { styleReady = true; reportLakeViewport(); });
    map.on("moveend", reportLakeViewport);
    // Mouse moves arrive faster than frames; handle only the latest one per frame.
    let latestMove: MapMouseEvent | undefined;
    const handleMove = (event: MapMouseEvent) => {
      if (lakeSelection && map?.getLayer("chart-lakes-fill")) {
        const feature = map.queryRenderedFeatures(event.point, { layers: ["chart-lakes-fill"] })[0];
        highlightLake(feature?.id);
      }
      if (!drawingLine) {
        if (pointer) { pointer = undefined; closable = false; }
        return;
      }
      closable = closesDraft(event.point);
      // Snapping the line to the first point is what shows the shape closing.
      const first = draftPoints[0];
      pointer = closable && first ? { lat: first.lat, lon: first.lon } : { lat: event.lngLat.lat, lon: wrapLongitude(event.lngLat.lng) };
    };
    map.on("mousemove", (event) => {
      latestMove = event;
      moveFrame ||= requestAnimationFrame(() => {
        moveFrame = 0;
        const move = latestMove;
        latestMove = undefined;
        if (move) handleMove(move);
      });
    });
    map.on("mouseout", () => { cancelAnimationFrame(moveFrame); moveFrame = 0; latestMove = undefined; highlightLake(); pointer = undefined; closable = false; });
    map.on("movestart", () => { if (hoveredLake !== undefined) highlightLake(); });
    map.on("click", (event) => {
      if (onLakeMapClick) {
        const feature = map?.getLayer("chart-lakes-fill") ? map.queryRenderedFeatures(event.point, { layers: ["chart-lakes-fill"] })[0] : undefined;
        onLakeMapClick(event.lngLat.lat, wrapLongitude(event.lngLat.lng), feature?.properties.id === undefined ? undefined : String(feature.properties.id));
        return;
      }
      if (drawingLine) {
        if (closesDraft(event.point)) { onFinishDraw?.(true); return; }
        onDrawPoint?.(roundDegrees(event.lngLat.lat), roundDegrees(wrapLongitude(event.lngLat.lng)));
        return;
      }
      if (!placingMarker || !onPlaceMarker) return;
      // Clicking an existing marker selects it for dragging, not a new placement.
      if (event.originalEvent.target instanceof Element && event.originalEvent.target.closest(".topostack-map-marker")) return;
      onPlaceMarker(roundDegrees(event.lngLat.lat), roundDegrees(wrapLongitude(event.lngLat.lng)));
    });
    // Ending a path on its last point should not also zoom the map.
    map.on("dblclick", (event) => {
      if (!drawingLine) return;
      event.preventDefault();
      onFinishDraw?.(false);
    });
    let reportedFailure = false;
    // Only a style that never loaded is a failure; this is earlier than `load`.
    let styleLoaded = false;
    map.once("style.load", () => { styleLoaded = true; });
    map.on("error", (event: MapErrorEvent) => {
      // Individual tiles fail routinely (offline pans, rate limits) and MapLibre
      // retries them; only a style that never loaded leaves a blank canvas.
      if (reportedFailure || styleLoaded || styleReady || event.sourceId !== undefined || event.tile !== undefined) return;
      reportedFailure = true;
      console.warn("TopoStack map style could not load.", event.error);
      onUnavailable?.("load-failed");
    });
    const emitSelection = () => {
      if (!map) return;
      const center = map.getCenter();
      const containerRect = container.getBoundingClientRect();
      const guideRect = guide.getBoundingClientRect();
      const northWest = map.unproject([guideRect.left - containerRect.left, guideRect.top - containerRect.top]);
      const southEast = map.unproject([guideRect.right - containerRect.left, guideRect.bottom - containerRect.top]);
      const longitude = ((center.lng + 180) % 360 + 360) % 360 - 180;
      const worldShift = longitude - center.lng;
      // This location already reflects the camera and guide on screen.
      // Do not fit it back into the default-sized guide after a pan or zoom.
      skipSelectionFit = true;
      onLocationChange(center.lat, longitude, map.getZoom(), { west: northWest.lng + worldShift, north: northWest.lat, east: southEast.lng + worldShift, south: southEast.lat });
    };
    // Only commit selections for movement the user caused. Programmatic camera
    // moves (initial load, flyTo from external location edits) must not
    // overwrite the stored place label or bounds.
    map.on("moveend", (event: MapMoveEndEvent) => {
      if (event.topostackProgrammatic) return;
      // Panning a map that is not choosing the terrain must not reframe it.
      if (!framing) return;
      emitSelection();
    });
    const resizeObserver = new ResizeObserver(() => fitSelection());
    resizeObserver.observe(container);
    fitSelection();
    return () => { clearTimeout(viewportTimer); cancelAnimationFrame(moveFrame); resizeObserver.disconnect(); mapMarkers.forEach((marker) => marker.remove()); mapMarkers.clear(); map?.remove(); map = undefined; };
  });

  $effect(() => {
    if (!styleReady || !map) return;
    const selection = lakeSelection;
    // A background viewport refresh must not clear feedback under a stationary pointer.
    if (hoveredLake !== undefined && !selection?.lakes.some(lake => lake.id === hoveredLake)) highlightLake();
    const data: FeatureCollection = { type: "FeatureCollection", features: (selection?.lakes ?? []).map(lake => ({ type: "Feature", id: lake.id, properties: { id: lake.id, name: lake.name, selected: lake.id === selection?.activeId }, geometry: { type: "Polygon", coordinates: [[...lake.outline, lake.outline[0]!]] } })) };
    const target = map;
    upsertGeoJson(target, "chart-lakes", data, () => [
      { id: "chart-lakes-fill", type: "fill", source: "chart-lakes", paint: { "fill-color": "#c4511b", "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.5, ["get", "selected"], 0.35, 0.12] } },
      { id: "chart-lakes-outline", type: "line", source: "chart-lakes", paint: { "line-color": "#c4511b", "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 4, ["get", "selected"], 3, 1.5] } },
      ...(target.getStyle()?.glyphs ? [{ id: "chart-lakes-label", type: "symbol", source: "chart-lakes", layout: { "text-field": ["get", "name"], "text-size": 12 }, paint: { "text-color": "#782b0b", "text-halo-color": "#ffffff", "text-halo-width": 2 } } satisfies AddLayerObject] : []),
    ], "id");
  });
  const lakeCameraBounds = $derived(lakeSelection?.bounds);
  $effect(() => { void lakeCameraBounds; if (styleReady) untrack(fitSelection); });

  // Deriveds only notify when the value itself changes, so a rename or slider
  // tick that replaces `project` does not refit the map or resync overlays.
  const selectedLocation = $derived(project.location);
  const cropShape = $derived(project.cropShape);
  const widthMm = $derived(project.widthMm);
  const heightMm = $derived(project.heightMm);
  /** Changes only when the chosen map area does, through the deriveds above. */
  const mapArea = $derived({ selectedLocation, cropShape, widthMm, heightMm });
  const markers = $derived(project.markers);
  const markerIcons = $derived(project.markerIcons);
  const customLines = $derived(project.customLines);

  $effect(() => {
    void mapArea;
    untrack(() => { if (skipSelectionFit) { skipSelectionFit = false; return; } fitSelection(); });
  });

  $effect(() => {
    const configuredMarkers = markers;
    void markerIcons;
    if (!map) return;
    const activeIds = new Set(configuredMarkers.map((marker) => marker.id));
    for (const [id, rendered] of mapMarkers) {
      if (!activeIds.has(id)) { rendered.remove(); mapMarkers.delete(id); }
    }
    for (const marker of configuredMarkers) {
      let rendered = mapMarkers.get(marker.id);
      if (rendered?.getElement().dataset.drawing !== untrack(() => markerDrawingKey(marker))) {
        rendered?.remove();
        rendered = undefined;
      }
      if (!rendered) {
        rendered = addRenderedMarker(marker, map);
        mapMarkers.set(marker.id, rendered);
      } else {
        rendered.setLngLat([marker.lon, marker.lat]);
        rendered.getElement().setAttribute("aria-label", markerLabel(marker));
        rendered.getElement().title = marker.name ?? "";
      }
    }
  });

  $effect(() => {
    const lines = customLines;
    syncCustomLines(lines);
  });

  $effect(() => {
    void mapArea;
    syncMapArea(!framing && !lakeSelection);
  });

  // Reading all three, so the drawn line follows the pointer and is cleared
  // the moment drawing ends, whether or not the points changed with it.
  $effect(() => {
    if (!drawingLine) { syncDraft([]); return; }
    syncDraft(draftPoints, pointer);
  });
</script>

<svelte:window onkeydown={(event) => {
  // A dialog's keys are its own. Enter in a field or on a button belongs to
  // that control too: Enter on "Cancel drawing" must cancel, not finish.
  const target = event.target instanceof Element ? event.target : undefined;
  if (target?.closest("dialog, [role=dialog]")) return;
  // Enter ends a path where it is; Escape abandons whatever is in progress.
  if (event.key === "Enter" && drawingLine) {
    if (!target?.closest("input, textarea, select, button, [contenteditable]")) onFinishDraw?.(false);
    return;
  }
  if (event.key !== "Escape") return;
  finishResize(true);
  if (placingMarker) onStopPlacing?.();
  if (drawingLine) onCancelDraw?.();
}} onblur={() => finishResize(true)} />

<div class="map-wrap">
  <div bind:this={container} class="map-canvas" class:placing-marker={placingMarker || drawingLine} class:closing-draft={closable}></div>
  {#if !isEmbedded() && framing}
  <div class="selection-tools">
    <label><input type="checkbox" bind:checked={aspectLocked} disabled={isCircle} /> {isCircle ? "Circle proportions locked" : "Lock aspect ratio"}</label>
    <span>Drag handles to resize · Hold Shift to lock · Esc to cancel</span>
  </div>
  {/if}
  <div bind:this={guide} class="crop-guide" class:crop-guide--idle={!framing} class:crop-circle={isCircle}>
    {#if framing}
    {#if isCircle}<div class="circle-outline" style:width={`${100 * Math.min(project.widthMm, project.heightMm) / project.widthMm}%`} style:height={`${100 * Math.min(project.widthMm, project.heightMm) / project.heightMm}%`}></div>{/if}
    {#each handles as handle}
      <button type="button" class="resize-handle" aria-label={`Resize selection ${handle.name}`} title={`Resize ${handle.name} (arrow keys supported)`}
        style:left={`${(handle.x + 1) * 50}%`} style:top={`${(handle.y + 1) * 50}%`}
        style:cursor={handle.x === 0 ? "ns-resize" : handle.y === 0 ? "ew-resize" : handle.x === handle.y ? "nwse-resize" : "nesw-resize"}
        onpointerdown={(event) => startResize(event, handle)} onpointermove={moveResize}
        onpointerup={() => finishResize()} onpointercancel={() => finishResize(true)} onlostpointercapture={() => finishResize(true)}
        onkeydown={(event) => {
          if (!map || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const rect = guide.getBoundingClientRect();
          drag = { pointerId: -1, x: 0, y: 0, width: rect.width, height: rect.height, widthMm: project.widthMm, heightMm: project.heightMm, handle };
          moveResize({ pointerId: -1, clientX: event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0, clientY: event.key === "ArrowUp" ? -5 : event.key === "ArrowDown" ? 5 : 0, shiftKey: event.shiftKey } as PointerEvent);
          finishResize();
        }}></button>
    {/each}
    {/if}
  </div>
  {#if framing}<div class="map-crosshair"><span></span><span></span></div>{/if}
  {#if isEmbedded()}<AtommZoom value={zoomScale} min={0.125} max={16} onZoom={setZoomScale} onFit={resetMapView} />{/if}
  {#if drawingLine}
    <div class="map-caption map-caption--placing" role="status"><Spline size={14} /> {draftPoints.length < 2 ? "Click the map to start the path" : draftPoints.length < 3 ? "Keep clicking · Enter to finish" : "Click the first point to close a boundary · Enter to finish"} · Esc to cancel</div>
  {:else if placingMarker}
    <div class="map-caption map-caption--placing" role="status"><MapPin size={14} /> Click to place · drag to move · Esc when done</div>
  {:else}
    <div class="map-caption"><LocateFixed size={14} /> {hint}</div>
  {/if}
</div>

<style>
  .crop-guide { box-sizing: border-box; }
  /* Kept in the layout so a pan can still be measured against it, but out of
     sight and out of reach where there is no map area to choose. */
  .crop-guide--idle { visibility: hidden; }
  /* A compact card in the top-right corner, which nothing else uses in map
     view: warnings stack top-left and outrank it, the map's own controls and
     attribution sit along the bottom. */
  .selection-tools { position: absolute; top: 12px; right: 12px; z-index: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: max-content; max-width: min(260px, calc(100% - 24px)); padding: 7px 10px; background: color-mix(in srgb, var(--loidolt-surface) 94%, transparent); color: var(--loidolt-text); border: var(--loidolt-border-width) solid var(--loidolt-border); border-radius: 6px; font-size: 12px; box-shadow: var(--loidolt-shadow-popover); }
  .selection-tools label { display: flex; align-items: center; gap: 6px; }
  .selection-tools span { font-size: 10px; color: var(--loidolt-text-muted); }
  .resize-handle { position: absolute; transform: translate(-50%, -50%); width: 20px; height: 20px; min-width: 0; padding: 0; border: 2px solid var(--loidolt-accent); border-radius: 3px; background: white; pointer-events: auto; touch-action: none; }
  .resize-handle:focus-visible { outline: 3px solid var(--loidolt-accent); outline-offset: 3px; }
  .circle-outline {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 0 0 9999px #20231d61;
  }

  :global(.topostack-map-marker) {
    width: 30px;
    height: 30px;
    color: #b84824;
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.55));
    pointer-events: none;
  }

  :global(.topostack-map-marker--draggable) {
    pointer-events: auto;
    cursor: grab;
  }

  :global(.topostack-map-marker--draggable:active) {
    cursor: grabbing;
  }

  .placing-marker :global(.maplibregl-canvas-container.maplibregl-interactive) {
    cursor: crosshair;
  }

  /* Over the first point, where a click closes the shape rather than adding to it. */
  .closing-draft :global(.maplibregl-canvas-container.maplibregl-interactive) {
    cursor: pointer;
  }

  .map-caption--placing {
    background: var(--loidolt-accent);
    color: var(--loidolt-on-accent);
  }

  :global(.topostack-map-marker svg) {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    fill: currentColor;
    stroke: #fff;
    stroke-width: 4.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    paint-order: stroke fill;
  }
</style>
