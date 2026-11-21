import * as THREE from 'three';
import { INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import type { Bounds3 } from '@clashflight/core';
import type { CollisionMeshData } from '../scene/SceneManager';
import type { CameraViewMode, CraftType, CraftVisualState } from './CraftVisual';

export interface CollisionEventInfo {
  speed: number;
  expressId?: number;
}

export interface DroneTelemetry {
  speed: number;
  altitude: number;
  speedTier: 1 | 2 | 3;
  boosting: boolean;
  ghostMode: boolean;
  pointerLocked: boolean;
  craftType: CraftType;
  cameraView: CameraViewMode;
}

const SPEED_TIERS: Record<1 | 2 | 3, number> = {
  1: 5,
  2: 10,
  3: 20,
};

const PLANE_CRUISE_TIERS: Record<1 | 2 | 3, number> = {
  1: 4.5,
  2: 8.5,
  3: 14.5,
};

const FIXED_DT = 1 / 60;
const DRONE_RADIUS = 0.45;
const BOOST_MULTIPLIER = 2.2;
const PLANE_BOOST_MULTIPLIER = 2.1;
const PLANE_MIN_AIRSPEED = 2.8;
const HARD_IMPACT_SPEED = 2.6;
const COLLISION_JOKE_COOLDOWN_SEC = 2.6;

/**
 * 6-DOF arcade drone & micro-plane flight controller with fixed-timestep integration,
 * velocity damping, speed tiers, ghost mode, 1st/3rd person camera, and sliding BVH collision.
 */
export class DroneController {
  readonly position = new THREE.Vector3(0, 2.5, 14);
  readonly velocity = new THREE.Vector3();

  private yaw = 0;
  private pitch = 0;
  private visualRoll = 0;
  private visualPitch = 0;
  private mouseTurnRate = 0;
  private speedTier: 1 | 2 | 3 = 2;
  private ghostMode = false;
  private craftType: CraftType = 'drone';
  private cameraView: CameraViewMode = 'first-person';
  private accumulator = 0;
  private collisionCooldown = 0;
  private rightMouseDown = false;
  private pointerLocked = false;
  private hasInitializedChaseCam = false;

  private readonly keys = new Set<string>();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;

  private readonly spawnPosition = new THREE.Vector3(0, 2.5, 14);
  private readonly spawnLookAt = new THREE.Vector3(0, 2.2, 0);
  private readonly chaseCamPos = new THREE.Vector3();

  // Reusable scratch objects to avoid per-frame allocations
  private readonly forwardVec = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();
  private readonly upVec = new THREE.Vector3(0, 1, 0);
  private readonly wishDir = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), DRONE_RADIUS);
  private readonly closestPt = new THREE.Vector3();
  private readonly pushVec = new THREE.Vector3();
  private readonly triNormal = new THREE.Vector3();
  private readonly chaseRay = new THREE.Ray();
  private readonly desiredCamPos = new THREE.Vector3();
  private readonly chaseDir = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  onCollision?: (info: CollisionEventInfo) => void;
  onFall?: () => void;
  onStateChange?: () => void;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.attachListeners();
    this.syncCamera(0, null);
  }

  setSpawn(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.spawnPosition.copy(position);
    this.spawnLookAt.copy(lookAt);
    this.teleportTo(position, lookAt);
  }

  teleportTo(position: THREE.Vector3, lookAt?: THREE.Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.visualRoll = 0;
    this.visualPitch = 0;
    this.hasInitializedChaseCam = false;
    if (lookAt) {
      const dir = new THREE.Vector3().subVectors(lookAt, position).normalize();
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = Math.asin(Math.max(-0.98, Math.min(0.98, dir.y)));
    }
    this.syncCamera(0, null);
  }

  setGhostMode(enabled: boolean): void {
    this.ghostMode = enabled;
    this.onStateChange?.();
  }

  toggleGhostMode(): boolean {
    this.setGhostMode(!this.ghostMode);
    return this.ghostMode;
  }

  setCraftType(type: CraftType): void {
    this.craftType = type;
    this.visualRoll = 0;
    this.visualPitch = 0;
    this.onStateChange?.();
  }

  toggleCraftType(): CraftType {
    this.setCraftType(this.craftType === 'drone' ? 'plane' : 'drone');
    return this.craftType;
  }

  setCameraView(mode: CameraViewMode): void {
    this.cameraView = mode;
    if (mode === 'third-person') {
      this.hasInitializedChaseCam = false;
    }
    this.syncCamera(0, null);
    this.onStateChange?.();
  }

  toggleCameraView(): CameraViewMode {
    this.setCameraView(
      this.cameraView === 'first-person' ? 'third-person' : 'first-person'
    );
    return this.cameraView;
  }

  setSpeedTier(tier: 1 | 2 | 3): void {
    this.speedTier = tier;
    this.onStateChange?.();
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.domElement) {
      this.domElement.requestPointerLock?.();
    }
  }

  getTelemetry(): DroneTelemetry {
    return {
      speed: this.velocity.length(),
      altitude: Math.max(0, this.position.y),
      speedTier: this.speedTier,
      boosting: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      ghostMode: this.ghostMode,
      pointerLocked: this.pointerLocked,
      craftType: this.craftType,
      cameraView: this.cameraView,
    };
  }

  getCraftState(): CraftVisualState & {
    craftType: CraftType;
    cameraView: CameraViewMode;
  } {
    return {
      position: this.position,
      yaw: this.yaw,
      pitch: this.craftType === 'drone' ? this.visualPitch : this.pitch,
      roll: this.visualRoll,
      speed: this.velocity.length(),
      boosting: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      craftType: this.craftType,
      cameraView: this.cameraView,
    };
  }

  update(
    dt: number,
    collisionData: CollisionMeshData | null,
    modelBounds: Bounds3 | null
  ): void {
    const clampedDt = Math.min(dt, 0.08);
    this.accumulator += clampedDt;
    if (this.collisionCooldown > 0) {
      this.collisionCooldown = Math.max(0, this.collisionCooldown - clampedDt);
    }

    while (this.accumulator >= FIXED_DT) {
      this.fixedStep(FIXED_DT, collisionData, modelBounds);
      this.accumulator -= FIXED_DT;
    }

    this.syncCamera(clampedDt, collisionData);
  }

  private fixedStep(
    dt: number,
    collisionData: CollisionMeshData | null,
    modelBounds: Bounds3 | null
  ): void {
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.forwardVec.set(0, 0, -1).applyEuler(this.euler).normalize();
    this.rightVec.set(1, 0, 0).applyEuler(this.euler).normalize();

    const isBoost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    if (this.craftType === 'plane') {
      this.stepPlane(dt, isBoost);
    } else {
      this.stepDrone(dt, isBoost);
    }

    // Decay transient mouse turn rate for smooth banking
    this.mouseTurnRate *= Math.exp(-10 * dt);

    const preSpeed = this.velocity.length();
    this.position.addScaledVector(this.velocity, dt);

    if (!this.ghostMode && collisionData) {
      const hitExpressId = this.resolveSphereCollisions(collisionData);
      if (
        hitExpressId !== null &&
        preSpeed >= HARD_IMPACT_SPEED &&
        this.collisionCooldown <= 0
      ) {
        this.collisionCooldown = COLLISION_JOKE_COOLDOWN_SEC;
        this.onCollision?.({
          speed: preSpeed,
          expressId: hitExpressId >= 0 ? hitExpressId : undefined,
        });
      }
    }

    // Check out-of-bounds / fell out of the model
    if (modelBounds) {
      const minY = modelBounds.min[1];
      const cx = (modelBounds.min[0] + modelBounds.max[0]) * 0.5;
      const cz = (modelBounds.min[2] + modelBounds.max[2]) * 0.5;
      const maxSpan = Math.max(
        modelBounds.max[0] - modelBounds.min[0],
        modelBounds.max[1] - modelBounds.min[1],
        modelBounds.max[2] - modelBounds.min[2]
      );
      const horizontalDist = Math.hypot(
        this.position.x - cx,
        this.position.z - cz
      );
      if (
        this.position.y < minY - 14 ||
        this.position.y > modelBounds.max[1] + Math.max(45, maxSpan * 1.8) ||
        horizontalDist > Math.max(70, maxSpan * 2.5)
      ) {
        this.teleportTo(this.spawnPosition, this.spawnLookAt);
        this.onFall?.();
      }
    }
  }

  private stepDrone(dt: number, isBoost: boolean): void {
    this.wishDir.set(0, 0, 0);
    let localForward = 0;
    let localStrafe = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
      this.wishDir.add(this.forwardVec);
      localForward += 1;
    }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      this.wishDir.sub(this.forwardVec);
      localForward -= 1;
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
      this.wishDir.add(this.rightVec);
      localStrafe += 1;
    }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      this.wishDir.sub(this.rightVec);
      localStrafe -= 1;
    }
    if (this.keys.has('Space') || this.keys.has('KeyE')) {
      this.wishDir.y += 1;
    }
    if (
      this.keys.has('ControlLeft') ||
      this.keys.has('KeyQ') ||
      this.keys.has('KeyC')
    ) {
      this.wishDir.y -= 1;
    }

    const baseSpeed = SPEED_TIERS[this.speedTier];
    const targetSpeed = isBoost ? baseSpeed * BOOST_MULTIPLIER : baseSpeed;

    if (this.wishDir.lengthSq() > 0) {
      this.wishDir.normalize();
      const targetVel = this.wishDir.multiplyScalar(targetSpeed);
      const accelLerp = 1 - Math.exp(-10 * dt);
      this.velocity.lerp(targetVel, accelLerp);
    } else {
      const damping = Math.exp(-8.5 * dt);
      this.velocity.multiplyScalar(damping);
      if (this.velocity.lengthSq() < 1e-4) {
        this.velocity.set(0, 0, 0);
      }
    }

    // Subtle visual tilt for 3rd-person drone look
    const targetPitch = -localForward * (isBoost ? 0.28 : 0.18);
    const targetRoll = -localStrafe * 0.24 + this.mouseTurnRate * 0.25;
    const tiltLerp = 1 - Math.exp(-10 * dt);
    this.visualPitch += (targetPitch - this.visualPitch) * tiltLerp;
    this.visualRoll += (targetRoll - this.visualRoll) * tiltLerp;
  }

  private stepPlane(dt: number, isBoost: boolean): void {
    const yawRate = 1.65;
    let steer = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      steer += 1;
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
      steer -= 1;
    }
    this.yaw += steer * yawRate * dt;

    let climbInput = 0;
    if (this.keys.has('Space') || this.keys.has('KeyE')) {
      climbInput += 1;
    }
    if (
      this.keys.has('ControlLeft') ||
      this.keys.has('KeyQ') ||
      this.keys.has('KeyC')
    ) {
      climbInput -= 1;
    }
    if (climbInput !== 0) {
      const maxPitch = (85 * Math.PI) / 180;
      this.pitch = Math.max(
        -maxPitch,
        Math.min(maxPitch, this.pitch + climbInput * 1.05 * dt)
      );
    }

    // Recompute forward vector after yaw/pitch key inputs
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.forwardVec.set(0, 0, -1).applyEuler(this.euler).normalize();

    const cruise = PLANE_CRUISE_TIERS[this.speedTier];
    let targetSpeed = cruise;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
      targetSpeed *= 1.45;
    } else if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      targetSpeed = Math.max(PLANE_MIN_AIRSPEED, cruise * 0.55);
    }
    if (isBoost) {
      targetSpeed *= PLANE_BOOST_MULTIPLIER;
    }

    const desiredVel = this.wishDir
      .copy(this.forwardVec)
      .multiplyScalar(targetSpeed);
    desiredVel.y += climbInput * 1.4;

    const steerLerp = 1 - Math.exp(-7.5 * dt);
    this.velocity.lerp(desiredVel, steerLerp);

    const targetRoll = Math.max(
      -0.72,
      Math.min(0.72, steer * 0.58 + this.mouseTurnRate * 0.65)
    );
    const rollLerp = 1 - Math.exp(-9 * dt);
    this.visualRoll += (targetRoll - this.visualRoll) * rollLerp;
    this.visualPitch = this.pitch;
  }

  /**
   * Runs BVH sphere shapecast over 3 quick relaxation passes and slides velocity
   * tangentially along contact normals. Returns hit expressId (-1 if none/unknown), or null if no contact.
   */
  private resolveSphereCollisions(data: CollisionMeshData): number | null {
    let hitExpressId: number | null = null;
    const radiusSq = DRONE_RADIUS * DRONE_RADIUS;

    for (let pass = 0; pass < 3; pass++) {
      this.sphere.center.copy(this.position);
      let resolvedAny = false;

      data.bvh.shapecast({
        intersectsBounds: (box) =>
          box.intersectsSphere(this.sphere) ? INTERSECTED : NOT_INTERSECTED,
        intersectsTriangle: (tri, triIndex) => {
          tri.closestPointToPoint(this.sphere.center, this.closestPt);
          this.pushVec.subVectors(this.sphere.center, this.closestPt);
          const distSq = this.pushVec.lengthSq();

          if (distSq < radiusSq) {
            const dist = Math.sqrt(distSq);
            if (dist > 1e-5) {
              this.pushVec.multiplyScalar(1 / dist);
            } else {
              tri.getNormal(this.triNormal);
              this.pushVec.copy(this.triNormal);
            }

            const penetration = DRONE_RADIUS - dist;
            this.sphere.center.addScaledVector(this.pushVec, penetration);
            this.position.copy(this.sphere.center);

            // Slide along surface by cancelling inward normal velocity component
            const inward = this.velocity.dot(this.pushVec);
            if (inward < 0) {
              this.velocity.addScaledVector(this.pushVec, -inward);
            }

            const origIndex = data.bvh.resolveTriangleIndex(triIndex);
            hitExpressId = data.triangleElementIds[origIndex] ?? -1;
            resolvedAny = true;
          }
        },
      });

      if (!resolvedAny) break;
    }

    return hitExpressId;
  }

  private syncCamera(
    dt: number,
    collisionData: CollisionMeshData | null
  ): void {
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');

    if (this.cameraView === 'first-person') {
      this.camera.position.copy(this.position);
      this.camera.quaternion.setFromEuler(this.euler);
      return;
    }

    this.forwardVec.set(0, 0, -1).applyEuler(this.euler).normalize();
    const isBoost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const backDistance =
      (this.craftType === 'plane' ? 3.5 : 3.0) + (isBoost ? 0.55 : 0);
    const heightOffset = this.craftType === 'plane' ? 1.05 : 0.95;

    this.desiredCamPos
      .copy(this.position)
      .addScaledVector(this.forwardVec, -backDistance)
      .addScaledVector(this.upVec, heightOffset);

    if (!this.ghostMode && collisionData) {
      this.chaseDir.subVectors(this.desiredCamPos, this.position);
      const desiredDist = this.chaseDir.length();
      if (desiredDist > 1e-4) {
        this.chaseDir.multiplyScalar(1 / desiredDist);
        this.chaseRay.set(this.position, this.chaseDir);
        const hit = collisionData.bvh.raycastFirst(
          this.chaseRay,
          THREE.DoubleSide,
          0.1,
          desiredDist
        );
        if (hit) {
          const clampedDist = Math.max(0.9, hit.distance - 0.35);
          this.desiredCamPos
            .copy(this.position)
            .addScaledVector(this.chaseDir, clampedDist);
        }
      }
    }

    if (!this.hasInitializedChaseCam || dt <= 0) {
      this.chaseCamPos.copy(this.desiredCamPos);
      this.hasInitializedChaseCam = true;
    } else {
      const camLerp = 1 - Math.exp(-14 * dt);
      this.chaseCamPos.lerp(this.desiredCamPos, camLerp);
    }

    this.camera.position.copy(this.chaseCamPos);
    this.lookTarget
      .copy(this.position)
      .addScaledVector(this.forwardVec, 6.0);
    this.camera.lookAt(this.lookTarget);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    ) {
      return;
    }
    this.keys.add(e.code);

    if (e.code === 'Digit1') this.setSpeedTier(1);
    if (e.code === 'Digit2') this.setSpeedTier(2);
    if (e.code === 'Digit3') this.setSpeedTier(3);
    if (e.code === 'KeyG' && !e.repeat) {
      this.toggleGhostMode();
    }
    if (e.code === 'KeyP' && !e.repeat) {
      this.toggleCraftType();
    }
    if (e.code === 'KeyV' && !e.repeat) {
      this.toggleCameraView();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.rightMouseDown = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked && !this.rightMouseDown) return;
    const sensitivity = 0.0022;
    this.yaw -= e.movementX * sensitivity;
    this.pitch -= e.movementY * sensitivity;
    const maxPitch = (85 * Math.PI) / 180;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    this.mouseTurnRate = Math.max(
      -1.2,
      Math.min(1.2, this.mouseTurnRate - e.movementX * 0.012)
    );
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.target !== this.domElement) return;
    if (e.button === 0 && !this.pointerLocked) {
      this.requestPointerLock();
    } else if (e.button === 2) {
      this.rightMouseDown = true;
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) {
      this.rightMouseDown = false;
    }
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    if (e.target === this.domElement) {
      e.preventDefault();
    }
  };

  private readonly onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.domElement;
    if (!this.pointerLocked) {
      this.keys.clear();
    }
    this.onStateChange?.();
  };

  private attachListeners(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    this.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }
}
