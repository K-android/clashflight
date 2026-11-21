import type { Issue, ModelIndex } from '@clashflight/core';
import type {
  CraftType,
  DroneTelemetry,
  MarkerUpdateResult,
  QualityPreset,
} from '@clashflight/engine';

export interface HudCallbacks {
  onLoadSample: () => void;
  onFilesSelected: (files: FileList | File[]) => void;
  onModeChange: (modeId: string) => void;
  onQualityChange: (preset: QualityPreset) => void;
  onCraftChange: (type: CraftType) => void;
  onToggleCraft: () => void;
  onToggleCameraView: () => void;
  onToggleGhost: () => void;
  onToggleXray: () => void;
  onToggleSeriousMode: () => void;
  onResolveActive: () => void;
  onWarpNext: () => void;
  onRespawn: () => void;
  onFovChange: (fov: number) => void;
  onResumeFlight: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

/**
 * Plain DOM HUD managing telemetry, mission scoring, issue inspection,
 * nearest-issue compass, Revit crash joke toast, drag/drop, and comfort settings.
 */
export class HudController {
  private readonly root: HTMLElement;
  private readonly cb: HudCallbacks;

  private speedEl!: HTMLElement;
  private altEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private tierBadge!: HTMLElement;
  private craftBtn!: HTMLButtonElement;
  private viewBtn!: HTMLButtonElement;
  private ghostBtn!: HTMLButtonElement;
  private xrayBtn!: HTMLButtonElement;
  private qualitySelect!: HTMLSelectElement;
  private modalCraftSelect!: HTMLSelectElement;
  private modalViewBtn!: HTMLButtonElement;

  private scoreEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private crashEl!: HTMLElement;
  private modeSelect!: HTMLSelectElement;
  private seriousBtn!: HTMLButtonElement;

  private compassCard!: HTMLElement;
  private compassArrow!: HTMLElement;
  private compassText!: HTMLElement;

  private issuePanel!: HTMLElement;
  private issueTitleEl!: HTMLElement;
  private issueBadgesEl!: HTMLElement;
  private issueDescEl!: HTMLElement;
  private issueElementsEl!: HTMLElement;

  private unplacedDrawer!: HTMLElement;
  private unplacedList!: HTMLElement;

  private jokeToast!: HTMLElement;
  private jokeTagEl!: HTMLElement;
  private jokeTextEl!: HTMLElement;
  private jokeTimer: number | null = null;

  private modalBackdrop!: HTMLElement;
  private modalStatus!: HTMLElement;
  private resumeBtn!: HTMLButtonElement;
  private dragOverlay!: HTMLElement;
  private fileInput!: HTMLInputElement;

  private xrayEnabled = false;
  private seriousEnabled = false;
  private hasModelLoaded = false;

  constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    this.cb = callbacks;
    this.renderSkeleton();
  }

  private renderSkeleton(): void {
    this.root.innerHTML = `
      <div class="hud-card hud-top-left">
        <div class="hud-title-row">
          <span class="hud-label">Flight Telemetry</span>
          <select id="cf-quality" class="hud-select" title="Render quality">
            <option value="low">Low</option>
            <option value="medium" selected>Med</option>
            <option value="high">High</option>
          </select>
        </div>
        <div class="telemetry-grid">
          <div class="metric">
            <div class="metric-val" id="cf-speed">0.0</div>
            <div class="metric-unit">m/s</div>
          </div>
          <div class="metric">
            <div class="metric-val" id="cf-alt">0.0</div>
            <div class="metric-unit">alt m</div>
          </div>
          <div class="metric">
            <div class="metric-val" id="cf-fps">60</div>
            <div class="metric-unit">FPS</div>
          </div>
        </div>
        <div class="badge-row">
          <span class="pill-badge active" id="cf-tier">Tier 2</span>
          <button class="pill-btn" id="cf-craft" type="button">[P] Craft: Drone</button>
          <button class="pill-btn" id="cf-view" type="button">[V] View: 1st</button>
          <button class="pill-btn" id="cf-ghost" type="button">[G] Ghost: OFF</button>
          <button class="pill-btn" id="cf-xray" type="button">[X] X-Ray: OFF</button>
        </div>
      </div>

      <div class="hud-card compass-bar" id="cf-compass">
        <span class="compass-arrow" id="cf-compass-arrow">▲</span>
        <span id="cf-compass-text">Load a model &amp; BCF to begin</span>
        <button class="pill-btn" id="cf-warp" type="button">[T] Next</button>
      </div>

      <div class="hud-card hud-top-right">
        <div class="hud-title-row">
          <span class="hud-label">Mission</span>
          <select id="cf-mode" class="hud-select">
            <option value="clash-hunt" selected>Clash Hunt</option>
            <option value="free-fly">Free Fly</option>
          </select>
        </div>
        <div class="mission-stats">
          <div class="score-big" id="cf-score">0 pts</div>
          <div class="mission-sub">
            <span id="cf-progress">0 / 0</span> · <span id="cf-timer">00:00</span>
          </div>
        </div>
        <div class="badge-row">
          <button class="pill-btn" id="cf-serious" type="button">Jokes: ON</button>
          <button class="pill-btn" id="cf-help-btn" type="button">[H] Menu</button>
        </div>
        <div class="crash-whisper">
          <span>crashes</span>
          <span id="cf-crashes">0</span>
        </div>
      </div>

      <div class="reticle"></div>

      <div class="joke-toast" id="cf-joke-toast">
        <div class="joke-tag" id="cf-joke-tag">Revit Warning</div>
        <div class="joke-text" id="cf-joke-text"></div>
      </div>

      <div class="hud-card issue-panel" id="cf-issue-panel">
        <div class="issue-header">
          <div class="issue-title" id="cf-issue-title"></div>
          <div class="badge-row" id="cf-issue-badges"></div>
        </div>
        <div class="issue-desc" id="cf-issue-desc"></div>
        <div class="element-chips" id="cf-issue-elements"></div>
        <button class="resolve-btn" id="cf-resolve-btn" type="button">
          [F] Mark Resolved
        </button>
      </div>

      <div class="hud-card controls-hint">
        <span><span class="kbd">Click</span> Look</span>
        <span><span class="kbd">WASD</span> Fly</span>
        <span><span class="kbd">Space/Q</span> Up/Dn</span>
        <span><span class="kbd">Shift</span> Boost</span>
        <span><span class="kbd">1-3</span> Speed</span>
        <span><span class="kbd">P</span> Craft</span>
        <span><span class="kbd">V</span> 1st/3rd</span>
        <span><span class="kbd">F</span> Resolve</span>
        <span><span class="kbd">H</span> Menu</span>
      </div>

      <div class="hud-card unplaced-drawer" id="cf-unplaced-drawer">
        <div class="hud-label">Unplaced Issues</div>
        <ul class="unplaced-list" id="cf-unplaced-list"></ul>
      </div>

      <div class="modal-backdrop visible" id="cf-modal">
        <div class="modal-card">
          <h1 class="brand-title">ClashFlight</h1>
          <p class="brand-sub">
            Fly through any IFC building model and resolve real BCF coordination
            issues in your browser. Models stay 100% local.
          </p>
          <button class="primary-btn" id="cf-load-sample" type="button">
            Load Sample Building &amp; Clashes (Instant Demo)
          </button>
          <div class="drop-zone">
            <div>Drop <strong>.ifc</strong> and <strong>.bcf / .bcfzip</strong> files anywhere on the window</div>
            <div class="drop-zone-actions">
              <button class="secondary-btn" id="cf-browse-files" type="button">
                Browse IFC / BCF Files
              </button>
              <button class="secondary-btn" id="cf-respawn-btn" type="button">
                [R] Respawn
              </button>
            </div>
            <input id="cf-file-input" type="file" accept=".ifc,.bcf,.bcfzip" multiple hidden />
          </div>
          <div class="status-line" id="cf-modal-status">Ready to fly.</div>
          <div class="setting-row">
            <label for="cf-modal-craft">Flight Craft (<span class="kbd">P</span>)</label>
            <select id="cf-modal-craft" class="hud-select">
              <option value="drone" selected>Arcade Drone (6-DOF)</option>
              <option value="plane">Micro Jet Plane</option>
            </select>
          </div>
          <div class="setting-row">
            <span>Camera View (<span class="kbd">V</span>)</span>
            <button class="pill-btn" id="cf-modal-view" type="button">1st Person</button>
          </div>
          <div class="setting-row">
            <label for="cf-fov-slider">Field of View (<span id="cf-fov-val">72</span>°)</label>
            <input id="cf-fov-slider" type="range" min="55" max="100" value="72" />
          </div>
          <div class="setting-row">
            <span>Serious Mode (hide crash jokes for client demos)</span>
            <button class="pill-btn" id="cf-modal-serious" type="button">OFF</button>
          </div>
          <button class="secondary-btn" id="cf-resume-btn" type="button" style="width:100%; margin-top:14px; display:none;">
            Resume Flight
          </button>
        </div>
      </div>

      <div class="drag-overlay" id="cf-drag-overlay">
        Drop .IFC or .BCFZIP to load into ClashFlight
      </div>
    `;

    this.speedEl = this.root.querySelector('#cf-speed')!;
    this.altEl = this.root.querySelector('#cf-alt')!;
    this.fpsEl = this.root.querySelector('#cf-fps')!;
    this.tierBadge = this.root.querySelector('#cf-tier')!;
    this.craftBtn = this.root.querySelector('#cf-craft')!;
    this.viewBtn = this.root.querySelector('#cf-view')!;
    this.ghostBtn = this.root.querySelector('#cf-ghost')!;
    this.xrayBtn = this.root.querySelector('#cf-xray')!;
    this.qualitySelect = this.root.querySelector('#cf-quality')!;
    this.modalCraftSelect = this.root.querySelector('#cf-modal-craft')!;
    this.modalViewBtn = this.root.querySelector('#cf-modal-view')!;

    this.scoreEl = this.root.querySelector('#cf-score')!;
    this.progressEl = this.root.querySelector('#cf-progress')!;
    this.timerEl = this.root.querySelector('#cf-timer')!;
    this.crashEl = this.root.querySelector('#cf-crashes')!;
    this.modeSelect = this.root.querySelector('#cf-mode')!;
    this.seriousBtn = this.root.querySelector('#cf-serious')!;

    this.compassCard = this.root.querySelector('#cf-compass')!;
    this.compassArrow = this.root.querySelector('#cf-compass-arrow')!;
    this.compassText = this.root.querySelector('#cf-compass-text')!;

    this.issuePanel = this.root.querySelector('#cf-issue-panel')!;
    this.issueTitleEl = this.root.querySelector('#cf-issue-title')!;
    this.issueBadgesEl = this.root.querySelector('#cf-issue-badges')!;
    this.issueDescEl = this.root.querySelector('#cf-issue-desc')!;
    this.issueElementsEl = this.root.querySelector('#cf-issue-elements')!;

    this.unplacedDrawer = this.root.querySelector('#cf-unplaced-drawer')!;
    this.unplacedList = this.root.querySelector('#cf-unplaced-list')!;

    this.jokeToast = this.root.querySelector('#cf-joke-toast')!;
    this.jokeTagEl = this.root.querySelector('#cf-joke-tag')!;
    this.jokeTextEl = this.root.querySelector('#cf-joke-text')!;

    this.modalBackdrop = this.root.querySelector('#cf-modal')!;
    this.modalStatus = this.root.querySelector('#cf-modal-status')!;
    this.resumeBtn = this.root.querySelector('#cf-resume-btn')!;
    this.dragOverlay = this.root.querySelector('#cf-drag-overlay')!;
    this.fileInput = this.root.querySelector('#cf-file-input')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.root
      .querySelector('#cf-load-sample')!
      .addEventListener('click', () => this.cb.onLoadSample());

    this.root
      .querySelector('#cf-browse-files')!
      .addEventListener('click', () => this.fileInput.click());

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files && this.fileInput.files.length > 0) {
        this.cb.onFilesSelected(this.fileInput.files);
        this.fileInput.value = '';
      }
    });

    this.craftBtn.addEventListener('click', () => this.cb.onToggleCraft());
    this.viewBtn.addEventListener('click', () => this.cb.onToggleCameraView());
    this.modalCraftSelect.addEventListener('change', () => {
      this.cb.onCraftChange(this.modalCraftSelect.value as CraftType);
    });
    this.modalViewBtn.addEventListener('click', () =>
      this.cb.onToggleCameraView()
    );
    this.ghostBtn.addEventListener('click', () => this.cb.onToggleGhost());
    this.xrayBtn.addEventListener('click', () => this.cb.onToggleXray());
    this.seriousBtn.addEventListener('click', () => this.cb.onToggleSeriousMode());
    this.root
      .querySelector('#cf-modal-serious')!
      .addEventListener('click', () => this.cb.onToggleSeriousMode());

    this.qualitySelect.addEventListener('change', () => {
      this.cb.onQualityChange(this.qualitySelect.value as QualityPreset);
    });

    this.modeSelect.addEventListener('change', () => {
      this.cb.onModeChange(this.modeSelect.value);
    });

    this.root
      .querySelector('#cf-resolve-btn')!
      .addEventListener('click', () => this.cb.onResolveActive());

    this.root
      .querySelector('#cf-warp')!
      .addEventListener('click', () => this.cb.onWarpNext());

    this.root
      .querySelector('#cf-respawn-btn')!
      .addEventListener('click', () => this.cb.onRespawn());

    this.root
      .querySelector('#cf-help-btn')!
      .addEventListener('click', () => this.toggleMenu());

    this.resumeBtn.addEventListener('click', () => {
      this.hideMenu();
      this.cb.onResumeFlight();
    });

    const fovSlider = this.root.querySelector<HTMLInputElement>('#cf-fov-slider')!;
    const fovVal = this.root.querySelector('#cf-fov-val')!;
    fovSlider.addEventListener('input', () => {
      const fov = Number(fovSlider.value);
      fovVal.textContent = String(fov);
      this.cb.onFovChange(fov);
    });
  }

  setStatus(message: string): void {
    this.modalStatus.textContent = message;
  }

  setDragVisible(visible: boolean): void {
    this.dragOverlay.classList.toggle('visible', visible);
  }

  showMenu(): void {
    this.modalBackdrop.classList.add('visible');
    this.resumeBtn.style.display = this.hasModelLoaded ? 'block' : 'none';
  }

  hideMenu(): void {
    this.modalBackdrop.classList.remove('visible');
  }

  toggleMenu(): void {
    if (this.modalBackdrop.classList.contains('visible')) {
      if (this.hasModelLoaded) {
        this.hideMenu();
        this.cb.onResumeFlight();
      }
    } else {
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      this.showMenu();
    }
  }

  isMenuVisible(): boolean {
    return this.modalBackdrop.classList.contains('visible');
  }

  markModelLoaded(): void {
    this.hasModelLoaded = true;
    this.resumeBtn.style.display = 'block';
  }

  setXrayEnabled(enabled: boolean): void {
    this.xrayEnabled = enabled;
    this.xrayBtn.classList.toggle('active', enabled);
    this.xrayBtn.textContent = `[X] X-Ray: ${enabled ? 'ON' : 'OFF'}`;
  }

  setSeriousMode(enabled: boolean): void {
    this.seriousEnabled = enabled;
    this.seriousBtn.classList.toggle('active', enabled);
    this.seriousBtn.textContent = enabled ? 'Serious: ON' : 'Jokes: ON';
    const modalBtn = this.root.querySelector('#cf-modal-serious')!;
    modalBtn.classList.toggle('active', enabled);
    modalBtn.textContent = enabled ? 'ON' : 'OFF';
  }

  updateTelemetry(telemetry: DroneTelemetry, fps: number): void {
    this.speedEl.textContent = telemetry.speed.toFixed(1);
    this.altEl.textContent = telemetry.altitude.toFixed(1);
    this.fpsEl.textContent = String(Math.round(fps));
    this.tierBadge.textContent = telemetry.boosting
      ? `Tier ${telemetry.speedTier} BOOST`
      : `Tier ${telemetry.speedTier}`;

    const isPlane = telemetry.craftType === 'plane';
    this.craftBtn.classList.toggle('active', isPlane);
    this.craftBtn.textContent = `[P] Craft: ${isPlane ? 'Plane' : 'Drone'}`;
    this.modalCraftSelect.value = telemetry.craftType;

    const isThird = telemetry.cameraView === 'third-person';
    this.viewBtn.classList.toggle('active', isThird);
    this.viewBtn.textContent = `[V] View: ${isThird ? '3rd' : '1st'}`;
    this.modalViewBtn.classList.toggle('active', isThird);
    this.modalViewBtn.textContent = isThird ? '3rd Person' : '1st Person';

    this.ghostBtn.classList.toggle('active', telemetry.ghostMode);
    this.ghostBtn.textContent = `[G] Ghost: ${telemetry.ghostMode ? 'ON' : 'OFF'}`;
  }

  updateMission(opts: {
    score: number;
    resolvedCount: number;
    placedCount: number;
    elapsedSeconds: number;
    crashCount: number;
    unplacedIssues: Issue[];
  }): void {
    this.scoreEl.textContent = `${opts.score} pts`;
    this.progressEl.textContent = `${opts.resolvedCount} / ${opts.placedCount}`;
    this.timerEl.textContent = formatTimer(opts.elapsedSeconds);
    this.crashEl.textContent = String(opts.crashCount);

    if (opts.unplacedIssues.length > 0) {
      this.unplacedDrawer.classList.add('visible');
      this.unplacedList.innerHTML = opts.unplacedIssues
        .map((i) => `<li>${escapeHtml(i.title)}</li>`)
        .join('');
    } else {
      this.unplacedDrawer.classList.remove('visible');
      this.unplacedList.innerHTML = '';
    }
  }

  updateCompass(
    markerState: MarkerUpdateResult,
    hasIssues: boolean
  ): void {
    if (!hasIssues) {
      this.compassArrow.style.transform = 'rotate(0deg)';
      this.compassText.textContent = this.hasModelLoaded
        ? 'Free exploration — drop a .bcfzip to load issues'
        : 'Load a model & BCF to begin';
      this.compassCard.style.opacity = '0.88';
      return;
    }

    if (!markerState.nearestUnresolved) {
      this.compassArrow.style.transform = 'rotate(0deg)';
      this.compassText.textContent = 'All placed issues resolved!';
      return;
    }

    const deg =
      markerState.nearestBearingRad !== null
        ? (markerState.nearestBearingRad * 180) / Math.PI
        : 0;
    this.compassArrow.style.transform = `rotate(${deg.toFixed(0)}deg)`;
    const dist =
      markerState.nearestDistance !== null
        ? `${markerState.nearestDistance.toFixed(1)}m`
        : '';
    this.compassText.textContent = `${dist} → ${markerState.nearestUnresolved.title}`;
  }

  updateInspectableIssue(
    issue: Issue | null,
    model: ModelIndex | null
  ): void {
    if (!issue) {
      this.issuePanel.classList.remove('visible');
      return;
    }

    this.issuePanel.classList.add('visible');
    this.issueTitleEl.textContent = issue.title;
    this.issueDescEl.textContent =
      issue.description ?? 'No description in BCF topic.';

    const badges: string[] = [];
    if (issue.priority) {
      badges.push(
        `<span class="pill-badge warn">${escapeHtml(issue.priority)}</span>`
      );
    }
    if (issue.discipline) {
      badges.push(
        `<span class="pill-badge active">${escapeHtml(issue.discipline)}</span>`
      );
    }
    badges.push(
      `<span class="pill-badge">${escapeHtml(issue.status.toUpperCase())}</span>`
    );
    this.issueBadgesEl.innerHTML = badges.join('');

    if (issue.elementKeys.length === 0) {
      this.issueElementsEl.innerHTML =
        '<span class="element-chip">Viewpoint placement (no linked IFC GUIDs)</span>';
    } else {
      const chips = issue.elementKeys.map((key) => {
        const el = model?.elements.get(key);
        if (!el) return `<span class="element-chip">#${escapeHtml(key)}</span>`;
        const label = el.name
          ? `${el.ifcClass}: ${el.name}`
          : `${el.ifcClass} (${el.ifcGuid ?? key})`;
        return `<span class="element-chip">${escapeHtml(label)}</span>`;
      });
      this.issueElementsEl.innerHTML = chips.join('');
    }
  }

  showToast(
    tag: string,
    text: string,
    kind: 'warning' | 'win' = 'warning',
    durationMs = 4200
  ): void {
    this.jokeTagEl.textContent = tag;
    this.jokeTextEl.textContent = text;
    this.jokeToast.classList.toggle('win', kind === 'win');
    this.jokeToast.classList.add('visible');

    if (this.jokeTimer !== null) {
      window.clearTimeout(this.jokeTimer);
    }
    this.jokeTimer = window.setTimeout(() => {
      this.jokeToast.classList.remove('visible');
      this.jokeTimer = null;
    }, durationMs);
  }
}
