// View cube in the top-right corner (Onshape style): click faces, edges or corners to
// orient the view; it rotates together with the main camera.

import * as THREE from 'three';

const FACES: { label: string; normal: THREE.Vector3; up: THREE.Vector3 }[] = [
  { label: 'Right', normal: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
  { label: 'Left', normal: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
  { label: 'Back', normal: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1) },
  { label: 'Front', normal: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
  { label: 'Top', normal: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  { label: 'Bottom', normal: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, -1, 0) },
];

function labelTexture(text: string, hover = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = hover ? '#ffd27a' : '#f2f5f8';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#9aa7b4';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 125, 125);
  g.fillStyle = '#3a4550';
  g.font = '600 26px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class ViewCube {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private cube: THREE.Mesh;
  private materials: THREE.MeshBasicMaterial[];
  private textures: { normal: THREE.Texture; hover: THREE.Texture }[];
  private hoverFace = -1;
  private highlight: THREE.Mesh;
  onPick: (dir: THREE.Vector3, up: THREE.Vector3) => void = () => {};
  /** Dragging the cube turns the camera (by the mouse motion in pixels, as dragging in the graphics area does). */
  onRotate: (dx: number, dy: number) => void = () => {};
  /** Right click on the cube: its menu (window coordinates). */
  onMenu: (x: number, y: number) => void = () => {};
  /** A press on the cube: a click picks a view, a drag (past a few pixels) turns the camera. */
  private press: { x: number; y: number; dragged: boolean; right: boolean } | null = null;

  constructor(size = 110) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewcube-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(size, size);
    // One plane per face so that labels are upright (side faces: +Z up).
    this.textures = FACES.map((f) => ({ normal: labelTexture(f.label), hover: labelTexture(f.label, true) }));
    this.materials = this.textures.map((t) => new THREE.MeshBasicMaterial({ map: t.normal }));
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshBasicMaterial({ visible: false }));
    FACES.forEach((f, i) => {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), this.materials[i]);
      const m = new THREE.Matrix4();
      const right = new THREE.Vector3().crossVectors(f.up, f.normal).normalize();
      m.makeBasis(right, f.up, f.normal);
      plane.quaternion.setFromRotationMatrix(m);
      plane.position.copy(f.normal).multiplyScalar(0.8);
      plane.userData.face = i;
      this.cube.add(plane);
    });
    this.scene.add(this.cube);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.cube.geometry),
      new THREE.LineBasicMaterial({ color: 0x8a96a3 }),
    );
    this.cube.add(edges);
    // axis triad at the back-left-bottom corner
    const axes = new THREE.Group();
    const mk = (dir: THREE.Vector3, color: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(1.15)]);
      axes.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color })));
    };
    mk(new THREE.Vector3(1, 0, 0), 0xd84a3a);
    mk(new THREE.Vector3(0, 1, 0), 0x3aa655);
    mk(new THREE.Vector3(0, 0, 1), 0x2f6fd1);
    axes.position.set(-0.95, -0.95, -0.95);
    this.scene.add(axes);
    this.highlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', () => (this.press = null));
    this.canvas.addEventListener('pointerleave', () => !this.press && this.setHover(-1, null));
    this.canvas.addEventListener('contextmenu', (e) => {
      // not the browser's menu ("Save image as…"): the cube's own opens on a right click that was not a drag
      e.preventDefault();
      e.stopPropagation();
    });
  }

  private onDown(e: PointerEvent) {
    // the left or the right button turns the view by dragging (the right one: the menu when it was not dragged)
    if (e.button !== 0 && e.button !== 2) return;
    this.press = { x: e.clientX, y: e.clientY, dragged: false, right: e.button === 2 };
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onUp(e: PointerEvent) {
    const p = this.press;
    this.press = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!p) return;
    if (p.dragged) this.onMove(e);
    else if (p.right) this.onMenu(e.clientX, e.clientY);
    else this.onClick(e);
  }

  private hit(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hits = rc.intersectObjects(this.cube.children.filter((c) => c instanceof THREE.Mesh), false);
    if (!hits.length) return null;
    const p = hits[0].point.clone().divideScalar(0.8); // in [-1,1]^3
    // snap each axis: near the boundary → ±1, else 0
    const s = (v: number) => (v > 0.6 ? 1 : v < -0.6 ? -1 : 0);
    const dir = new THREE.Vector3(s(p.x), s(p.y), s(p.z));
    return { dir, face: (hits[0].object.userData.face as number) ?? -1, point: hits[0].point };
  }

  private setHover(face: number, point: THREE.Vector3 | null, dir?: THREE.Vector3) {
    const isFace = dir ? Math.abs(dir.x) + Math.abs(dir.y) + Math.abs(dir.z) === 1 : false;
    const f = isFace ? face : -1;
    if (f !== this.hoverFace) {
      if (this.hoverFace >= 0) this.materials[this.hoverFace].map = this.textures[this.hoverFace].normal;
      if (f >= 0) this.materials[f].map = this.textures[f].hover;
      this.hoverFace = f;
    }
    if (point && dir && !isFace) {
      this.highlight.visible = true;
      this.highlight.position.copy(dir).multiplyScalar(0.8);
    } else this.highlight.visible = false;
    this.canvas.style.cursor = point ? 'pointer' : 'default';
    this.render();
  }

  private onMove(e: PointerEvent) {
    const p = this.press;
    if (p) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.dragged && Math.hypot(dx, dy) < 3) return;
      // the cube is small: it turns the view twice as fast as the graphics area does
      if (!p.dragged) this.setHover(-1, null);
      p.dragged = true;
      p.x = e.clientX;
      p.y = e.clientY;
      this.canvas.style.cursor = 'grabbing';
      this.onRotate(dx * 2, dy * 2);
      return;
    }
    const h = this.hit(e);
    this.setHover(h ? h.face : -1, h ? h.point : null, h?.dir);
  }

  private onClick(e: MouseEvent) {
    const h = this.hit(e);
    if (!h || h.dir.lengthSq() === 0) return;
    const dir = h.dir.clone().normalize();
    let up = new THREE.Vector3(0, 0, 1);
    if (Math.abs(dir.z) > 0.99) up = dir.z > 0 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, -1, 0);
    this.onPick(dir, up);
  }

  sync(quat: THREE.Quaternion) {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    this.camera.position.copy(back.multiplyScalar(4));
    this.camera.quaternion.copy(quat);
    this.camera.updateMatrixWorld();
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
