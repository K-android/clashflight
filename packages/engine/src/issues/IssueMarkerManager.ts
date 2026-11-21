import * as THREE from 'three';
import type { Issue } from '@clashflight/core';

interface MarkerEntry {
  issue: Issue;
  root: THREE.Group;
  core: THREE.Mesh;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
  baseY: number;
}

export interface MarkerUpdateResult {
  inspectableIssue: Issue | null;
  inspectableDistance: number | null;
  nearestUnresolved: Issue | null;
  nearestDistance: number | null;
  nearestBearingRad: number | null;
}

const COLOR_CRITICAL = 0xff4757;
const COLOR_MEDIUM = 0xffa502;
const COLOR_LOW = 0xffd32a;
const COLOR_INSPECTED = 0x00d2d3;
const COLOR_RESOLVED = 0x2ed573;

function colorForIssue(issue: Issue, isInspected: boolean): number {
  if (issue.status === 'resolved' || issue.status === 'closed') {
    return COLOR_RESOLVED;
  }
  if (isInspected) {
    return COLOR_INSPECTED;
  }
  const p = (issue.priority ?? '').trim().toLowerCase();
  if (p === 'critical' || p === 'high' || p === 'major') {
    return COLOR_CRITICAL;
  }
  if (p === 'low' || p === 'minor') {
    return COLOR_LOW;
  }
  return COLOR_MEDIUM;
}

/**
 * Renders animated 3D issue beacons in the Three.js scene and tracks
 * proximity for inspection and nearest-issue compass guidance.
 */
export class IssueMarkerManager {
  private readonly parentGroup: THREE.Group;
  private readonly entries = new Map<string, MarkerEntry>();
  private elapsed = 0;

  private readonly coreGeo = new THREE.OctahedronGeometry(0.36, 0);
  private readonly ringGeo = new THREE.TorusGeometry(0.62, 0.045, 10, 32);
  private readonly beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.2, 12, 1, true);

  private readonly camForward = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();

  constructor(parentGroup: THREE.Group) {
    this.parentGroup = parentGroup;
    this.ringGeo.rotateX(Math.PI / 2);
  }

  setIssues(
    issues: Issue[],
    inspectedIds: ReadonlySet<string> = new Set()
  ): void {
    this.clear();

    for (const issue of issues) {
      if (!issue.position) continue;
      const color = colorForIssue(issue, inspectedIds.has(issue.id));

      const root = new THREE.Group();
      root.position.set(issue.position[0], issue.position[1], issue.position[2]);

      const coreMat = new THREE.MeshBasicMaterial({
        color,
        wireframe: false,
      });
      const core = new THREE.Mesh(this.coreGeo, coreMat);

      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
      });
      const ring = new THREE.Mesh(this.ringGeo, ringMat);

      const beamMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const beam = new THREE.Mesh(this.beamGeo, beamMat);

      root.add(core);
      root.add(ring);
      root.add(beam);
      this.parentGroup.add(root);

      const entry: MarkerEntry = {
        issue,
        root,
        core,
        ring,
        beam,
        baseY: issue.position[1],
      };
      this.entries.set(issue.id, entry);
      this.applyVisualState(entry, inspectedIds.has(issue.id));
    }
  }

  updateIssueVisual(issue: Issue, isInspected: boolean): void {
    const entry = this.entries.get(issue.id);
    if (!entry) return;
    entry.issue = issue;
    this.applyVisualState(entry, isInspected);
  }

  private applyVisualState(entry: MarkerEntry, isInspected: boolean): void {
    const color = colorForIssue(entry.issue, isInspected);
    const resolved =
      entry.issue.status === 'resolved' || entry.issue.status === 'closed';

    (entry.core.material as THREE.MeshBasicMaterial).color.setHex(color);
    (entry.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    (entry.beam.material as THREE.MeshBasicMaterial).color.setHex(color);

    const scale = resolved ? 0.52 : 1.0;
    entry.root.scale.setScalar(scale);
    entry.beam.visible = !resolved;
    (entry.ring.material as THREE.MeshBasicMaterial).opacity = resolved
      ? 0.35
      : 0.85;
  }

  update(
    dt: number,
    camera: THREE.Camera,
    inspectRadius = 5.5,
    originPos?: THREE.Vector3
  ): MarkerUpdateResult {
    this.elapsed += dt;
    const refPos = originPos ?? camera.position;

    let inspectableIssue: Issue | null = null;
    let inspectableDistance = Infinity;
    let nearestUnresolved: Issue | null = null;
    let nearestDistance = Infinity;

    let idx = 0;
    for (const entry of this.entries.values()) {
      const phase = this.elapsed * 2.2 + idx * 0.9;
      idx += 1;

      const isResolved =
        entry.issue.status === 'resolved' || entry.issue.status === 'closed';

      entry.core.rotation.y += dt * (isResolved ? 0.4 : 1.8);
      entry.core.position.y = Math.sin(phase) * 0.14;
      const ringPulse = isResolved ? 1 : 1 + Math.sin(phase * 1.4) * 0.15;
      entry.ring.scale.set(ringPulse, 1, ringPulse);

      const dist = refPos.distanceTo(entry.root.position);
      if (!isResolved) {
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestUnresolved = entry.issue;
        }
        if (dist <= inspectRadius && dist < inspectableDistance) {
          inspectableDistance = dist;
          inspectableIssue = entry.issue;
        }
      }
    }

    let nearestBearingRad: number | null = null;
    if (nearestUnresolved?.position) {
      camera.getWorldDirection(this.camForward);
      this.camForward.y = 0;
      if (this.camForward.lengthSq() > 1e-5) {
        this.camForward.normalize();
      } else {
        this.camForward.set(0, 0, -1);
      }
      this.camRight.set(-this.camForward.z, 0, this.camForward.x);

      this.toTarget.set(
        nearestUnresolved.position[0] - refPos.x,
        0,
        nearestUnresolved.position[2] - refPos.z
      );
      if (this.toTarget.lengthSq() > 1e-4) {
        this.toTarget.normalize();
        const fwdDot = this.camForward.dot(this.toTarget);
        const rightDot = this.camRight.dot(this.toTarget);
        nearestBearingRad = Math.atan2(rightDot, fwdDot);
      }
    }

    return {
      inspectableIssue,
      inspectableDistance:
        inspectableIssue !== null ? inspectableDistance : null,
      nearestUnresolved,
      nearestDistance: nearestUnresolved !== null ? nearestDistance : null,
      nearestBearingRad,
    };
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      (entry.core.material as THREE.Material).dispose();
      (entry.ring.material as THREE.Material).dispose();
      (entry.beam.material as THREE.Material).dispose();
      this.parentGroup.remove(entry.root);
    }
    this.entries.clear();
  }

  dispose(): void {
    this.clear();
    this.coreGeo.dispose();
    this.ringGeo.dispose();
    this.beamGeo.dispose();
  }
}
