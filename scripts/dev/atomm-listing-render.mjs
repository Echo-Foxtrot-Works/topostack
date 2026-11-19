import { installNativeCapture } from "./atomm-native-capture.mjs";

// Drives the embedded studio for listing media: one page per project, the
// platform SDK replaced by a stand-in that keeps the export hook, and the
// production data API proxied so real terrain and survey data load.
const SDK = "window.atomm = { lifecycle: { on(event, hook) { if (event === 'export') window.captureExport = hook; } }, app: { getLocale: async () => 'en', getSupportedLocales: async () => [] }, ui: { toast: async () => '', closeToast: async () => {} } };";

export async function openStudio(browser, origin, project, { viewport = { width: 1600, height: 1000 }, scale = 1, onResponse } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale, colorScheme: "light", reducedMotion: "reduce" });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  if (onResponse) page.on("response", onResponse);
  await installNativeCapture(page);
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: SDK }));
  await page.route("https://topostack.app/v1/**", async route => {
    const headers = { ...route.request().headers() }; delete headers.origin; delete headers.referer;
    await route.fulfill({ response: await route.fetch({ headers, timeout: 180_000 }) });
  });
  await page.route(`${origin}/atomm-media-frame`, route => route.fulfill({ contentType: "text/html", body: '<body style="margin:0"><iframe src="/studio" style="width:100vw;height:100vh;border:0;display:block"></iframe></body>' }));
  await page.goto(origin);
  await page.evaluate(async value => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keyval");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put(value, "topostack:project:v1");
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  }, project);
  await page.goto(`${origin}/atomm-media-frame`);
  const studio = page.frameLocator("iframe");
  await studio.locator(".status-line", { hasText: "Real terrain ready" }).waitFor({ timeout: 240_000 });
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  const settled = async () => { await studio.locator('.preview-stage[aria-busy="false"]').waitFor({ timeout: 240_000 }); await page.waitForTimeout(1000); };
  await settled();
  return { page, studio, frame, settled, errors };
}

/**
 * The model rendered twice by the studio's own renderer, over white and over
 * black, so its alpha can be recovered for compositing. Only the camera, the
 * key light's angle and colour, and the background change; meshes, materials
 * and geometry are the studio's.
 */
export async function matte(frame, options) {
  const [white, black] = await frame.evaluate(o => {
    const { runtime: r, THREE, applyExploded } = window.__topostackNativeCapture();
    if (!r?.content.children.length) throw new Error("Native terrain scene is not ready");
    const { renderer, camera, content, rig, keyLight } = r;
    const scene = rig.parent;
    const keep = { bg: scene.background, key: keyLight.position.clone(), color: keyLight.color.clone(), intensity: keyLight.intensity, exposure: renderer.toneMappingExposure, position: camera.position.clone(), quaternion: camera.quaternion.clone(), up: camera.up.clone(), aspect: camera.aspect, near: camera.near, far: camera.far, size: renderer.getSize(new THREE.Vector2()), ratio: renderer.getPixelRatio(), rotation: rig.rotation.clone(), lift: rig.position.z, z: content.children.map(child => child.position.z) };
    try {
      rig.rotation.set(0, 0, 0); rig.position.z = 0; applyExploded(content, o.explode ?? 0); rig.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(content), target = box.getCenter(new THREE.Vector3()), span = box.getSize(new THREE.Vector3()).length();
      const az = o.azimuth * Math.PI / 180, el = o.elevation * Math.PI / 180;
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el));
      const la = (o.lightAzimuth ?? 205) * Math.PI / 180, le = (o.lightElevation ?? 30) * Math.PI / 180;
      keyLight.position.copy(target).add(new THREE.Vector3(Math.cos(la) * Math.cos(le), Math.sin(la) * Math.cos(le), Math.sin(le)).multiplyScalar(span));
      keyLight.target.position.copy(target); keyLight.target.updateMatrixWorld();
      const sc = keyLight.shadow.camera, half = span * 0.6; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = span * 3; sc.updateProjectionMatrix();
      keyLight.color.set(o.keyColor ?? "#ffd49a"); keyLight.intensity = o.keyIntensity ?? 3.8; renderer.toneMappingExposure = o.exposure ?? 1.08;
      camera.up.set(0, 0, 1); camera.aspect = o.width / o.height; camera.position.copy(target).add(dir); camera.lookAt(target); camera.updateMatrixWorld(true);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), tan = Math.tan(camera.fov * Math.PI / 360);
      let distance = 0;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const v = new THREE.Vector3(x, y, z).sub(target);
        distance = Math.max(distance, v.dot(dir) + Math.max(Math.abs(v.dot(right)) / (tan * camera.aspect), Math.abs(v.dot(up)) / tan));
      }
      camera.position.copy(target).addScaledVector(dir, distance * (o.fill ?? 1.02)); camera.near = 1; camera.far = 20000; camera.updateProjectionMatrix();
      renderer.setPixelRatio(1); renderer.setSize(o.width, o.height, false); renderer.shadowMap.needsUpdate = true;
      return ["#ffffff", "#000000"].map(color => { scene.background = new THREE.Color(color); renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png").split(",")[1]; });
    } finally {
      scene.background = keep.bg; keyLight.position.copy(keep.key); keyLight.color.copy(keep.color); keyLight.intensity = keep.intensity; renderer.toneMappingExposure = keep.exposure;
      content.children.forEach((child, i) => { child.position.z = keep.z[i]; });
      rig.rotation.copy(keep.rotation); rig.position.z = keep.lift;
      camera.position.copy(keep.position); camera.quaternion.copy(keep.quaternion); camera.up.copy(keep.up); camera.aspect = keep.aspect; camera.near = keep.near; camera.far = keep.far; camera.updateProjectionMatrix();
      renderer.setPixelRatio(keep.ratio); renderer.setSize(keep.size.x, keep.size.y, false); renderer.shadowMap.needsUpdate = true; r.requestRender();
    }
  }, { width: 2000, height: 1500, azimuth: -80, elevation: 55, ...options });
  return { white: Buffer.from(white, "base64"), black: Buffer.from(black, "base64") };
}

/** The project's flat-engraving artwork, exactly as Open in Studio would send it. */
export async function engravingSvg({ studio, frame, settled }) {
  await studio.getByRole("radio", { name: "Flat engraving", exact: true }).click();
  await settled();
  const svg = await frame.evaluate(async () => (await window.captureExport({ intent: "openInStudio" })).blob.text());
  await studio.getByRole("radio", { name: "Layered relief", exact: true }).click();
  await settled();
  return svg;
}
