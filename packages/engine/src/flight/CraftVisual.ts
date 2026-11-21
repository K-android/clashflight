import * as THREE from 'three';

export type CraftType = 'drone' | 'plane';
export type CameraViewMode = 'first-person' | 'third-person';

export interface CraftVisualState {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  boosting: boolean;
}

/**
 * Procedural 3D drone and micro-jet plane meshes displayed in 3rd-person view.
 * Both crafts face -Z (Three.js camera forward).
 */
export class CraftVisual {
  readonly root = new THREE.Group();

  private readonly droneGroup = new THREE.Group();
  private readonly planeGroup = new THREE.Group();
  private readonly rotors: THREE.Object3D[] = [];
  private readonly rotorDiscs: THREE.Mesh[] = [];
  private afterburner: THREE.Mesh | null = null;
  private afterburnerLight: THREE.PointLight | null = null;

  private craftType: CraftType = 'drone';
  private elapsed = 0;

  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor() {
    this.buildDroneMesh();
    this.buildPlaneMesh();

    this.root.add(this.droneGroup);
    this.root.add(this.planeGroup);
    this.setCraftType('drone');
    this.setVisible(false);
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  private buildDroneMesh(): void {
    const bodyMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.42,
        metalness: 0.55,
      })
    );
    const accentMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x22d3ee,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.75,
        roughness: 0.3,
      })
    );
    const armMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.5,
        metalness: 0.65,
      })
    );
    const bladeMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.35,
        metalness: 0.2,
      })
    );
    const discMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const redLedMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0xff4757 })
    );
    const greenLedMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0x2ed573 })
    );

    // Central chassis & top deck
    const chassis = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.24, 0.08, 0.34)),
      bodyMat
    );
    this.droneGroup.add(chassis);

    const canopy = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.16, 0.055, 0.2)),
      armMat
    );
    canopy.position.set(0, 0.06, 0.02);
    this.droneGroup.add(canopy);

    // Front glowing visor facing -Z
    const visor = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.14, 0.04, 0.04)),
      accentMat
    );
    visor.position.set(0, 0.01, -0.175);
    this.droneGroup.add(visor);

    // 4 diagonal arms & rotors
    const armGeo = this.trackGeo(new THREE.BoxGeometry(0.036, 0.024, 0.44));
    const motorGeo = this.trackGeo(new THREE.CylinderGeometry(0.035, 0.038, 0.05, 12));
    const bladeGeo = this.trackGeo(new THREE.BoxGeometry(0.28, 0.008, 0.026));
    const discGeo = this.trackGeo(new THREE.RingGeometry(0.03, 0.145, 24));
    discGeo.rotateX(Math.PI / 2);
    const ledGeo = this.trackGeo(new THREE.SphereGeometry(0.018, 8, 8));

    const armOffsets: Array<{ x: number; z: number; angle: number; front: boolean; right: boolean }> = [
      { x: -0.24, z: -0.24, angle: Math.PI / 4, front: true, right: false },
      { x: 0.24, z: -0.24, angle: -Math.PI / 4, front: true, right: true },
      { x: -0.24, z: 0.24, angle: -Math.PI / 4, front: false, right: false },
      { x: 0.24, z: 0.24, angle: Math.PI / 4, front: false, right: true },
    ];

    for (const cfg of armOffsets) {
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(cfg.x * 0.5, 0.005, cfg.z * 0.5);
      arm.rotation.y = cfg.angle;
      this.droneGroup.add(arm);

      const motor = new THREE.Mesh(motorGeo, bodyMat);
      motor.position.set(cfg.x, 0.03, cfg.z);
      this.droneGroup.add(motor);

      const rotorPivot = new THREE.Group();
      rotorPivot.position.set(cfg.x, 0.062, cfg.z);

      const blade1 = new THREE.Mesh(bladeGeo, bladeMat);
      const blade2 = new THREE.Mesh(bladeGeo, bladeMat);
      blade2.rotation.y = Math.PI / 2;
      rotorPivot.add(blade1, blade2);
      this.droneGroup.add(rotorPivot);
      this.rotors.push(rotorPivot);

      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.set(cfg.x, 0.062, cfg.z);
      this.droneGroup.add(disc);
      this.rotorDiscs.push(disc);

      const led = new THREE.Mesh(
        ledGeo,
        cfg.front ? accentMat : cfg.right ? greenLedMat : redLedMat
      );
      led.position.set(cfg.x, -0.008, cfg.z);
      this.droneGroup.add(led);
    }
  }

  private buildPlaneMesh(): void {
    const hullMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.32,
        metalness: 0.4,
      })
    );
    const wingMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.42,
        metalness: 0.5,
      })
    );
    const stripeMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x0891b2,
        emissiveIntensity: 0.5,
        roughness: 0.3,
      })
    );
    const canopyMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0369a1,
        emissiveIntensity: 0.35,
        roughness: 0.15,
        metalness: 0.85,
      })
    );
    const exhaustMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const redLedMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0xff4757 })
    );
    const greenLedMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0x2ed573 })
    );

    // Fuselage cylinder oriented along Z
    const fuselageGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.075, 0.09, 0.68, 14)
    );
    fuselageGeo.rotateX(Math.PI / 2);
    const fuselage = new THREE.Mesh(fuselageGeo, hullMat);
    this.planeGroup.add(fuselage);

    // Sleek nose cone pointing -Z
    const noseGeo = this.trackGeo(new THREE.ConeGeometry(0.075, 0.26, 14));
    noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, stripeMat);
    nose.position.set(0, 0, -0.47);
    this.planeGroup.add(nose);

    // Tinted bubble cockpit canopy
    const canopyGeo = this.trackGeo(new THREE.SphereGeometry(0.078, 12, 10));
    canopyGeo.scale(0.85, 0.72, 1.8);
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 0.065, -0.1);
    this.planeGroup.add(canopy);

    // Swept main wings (left & right)
    const wingGeo = this.trackGeo(new THREE.BoxGeometry(0.46, 0.022, 0.22));
    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.position.set(-0.24, -0.005, 0.04);
    leftWing.rotation.y = 0.26;
    const rightWing = new THREE.Mesh(wingGeo, wingMat);
    rightWing.position.set(0.24, -0.005, 0.04);
    rightWing.rotation.y = -0.26;
    this.planeGroup.add(leftWing, rightWing);

    // Wing accent strips
    const trimGeo = this.trackGeo(new THREE.BoxGeometry(0.44, 0.025, 0.045));
    const leftTrim = new THREE.Mesh(trimGeo, stripeMat);
    leftTrim.position.set(-0.24, -0.004, 0.01);
    leftTrim.rotation.y = 0.26;
    const rightTrim = new THREE.Mesh(trimGeo, stripeMat);
    rightTrim.position.set(0.24, -0.004, 0.01);
    rightTrim.rotation.y = -0.26;
    this.planeGroup.add(leftTrim, rightTrim);

    // Wingtip nav lights (red port, green starboard)
    const tipGeo = this.trackGeo(new THREE.SphereGeometry(0.02, 8, 8));
    const portLight = new THREE.Mesh(tipGeo, redLedMat);
    portLight.position.set(-0.46, -0.005, 0.11);
    const stbdLight = new THREE.Mesh(tipGeo, greenLedMat);
    stbdLight.position.set(0.46, -0.005, 0.11);
    this.planeGroup.add(portLight, stbdLight);

    // Horizontal & vertical tail stabilizers
    const hStabGeo = this.trackGeo(new THREE.BoxGeometry(0.32, 0.018, 0.11));
    const hStab = new THREE.Mesh(hStabGeo, wingMat);
    hStab.position.set(0, 0.015, 0.31);
    this.planeGroup.add(hStab);

    const vStabGeo = this.trackGeo(new THREE.BoxGeometry(0.02, 0.18, 0.14));
    const vStab = new THREE.Mesh(vStabGeo, stripeMat);
    vStab.position.set(0, 0.1, 0.3);
    vStab.rotation.x = -0.28;
    this.planeGroup.add(vStab);

    // Afterburner cone pointing +Z
    const flameGeo = this.trackGeo(new THREE.ConeGeometry(0.055, 0.26, 12));
    flameGeo.rotateX(Math.PI / 2);
    flameGeo.translate(0, 0, 0.13);
    this.afterburner = new THREE.Mesh(flameGeo, exhaustMat);
    this.afterburner.position.set(0, 0, 0.34);
    this.planeGroup.add(this.afterburner);

    this.afterburnerLight = new THREE.PointLight(0x22d3ee, 0.6, 3.5);
    this.afterburnerLight.position.set(0, 0, 0.44);
    this.planeGroup.add(this.afterburnerLight);
  }

  setCraftType(type: CraftType): void {
    this.craftType = type;
    this.droneGroup.visible = type === 'drone';
    this.planeGroup.visible = type === 'plane';
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  update(dt: number, state: CraftVisualState): void {
    this.elapsed += dt;
    this.root.position.copy(state.position);
    this.euler.set(state.pitch, state.yaw, state.roll, 'YXZ');
    this.root.quaternion.setFromEuler(this.euler);

    if (this.craftType === 'drone') {
      const spinSpeed =
        22 + state.speed * 2.5 + (state.boosting ? 16 : 0);
      for (let i = 0; i < this.rotors.length; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        this.rotors[i].rotation.y += dir * spinSpeed * dt;
      }
      const discOpacity = state.boosting ? 0.36 : 0.2;
      for (const disc of this.rotorDiscs) {
        (disc.material as THREE.MeshBasicMaterial).opacity = discOpacity;
      }
    } else if (this.afterburner) {
      const pulse = 1 + Math.sin(this.elapsed * 32) * 0.12;
      const speedRatio = Math.min(1.6, Math.max(0.4, state.speed / 12));
      const lenScale = (state.boosting ? 1.85 : 0.85 * speedRatio) * pulse;
      this.afterburner.scale.set(
        state.boosting ? 1.25 : 0.9,
        state.boosting ? 1.25 : 0.9,
        lenScale
      );
      const flameMat = this.afterburner.material as THREE.MeshBasicMaterial;
      flameMat.color.setHex(state.boosting ? 0xf59e0b : 0x22d3ee);
      if (this.afterburnerLight) {
        this.afterburnerLight.color.setHex(
          state.boosting ? 0xf59e0b : 0x22d3ee
        );
        this.afterburnerLight.intensity = state.boosting ? 1.4 : 0.55;
      }
    }
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}
