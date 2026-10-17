import "./styles.css";
import { detectFront, type Detection } from "./lib/detect";
import { defaultFront, defaultSide, surgeryLimb } from "./lib/geometry";
import {
  CORNER_SURGERY,
  EYELID_DESIGN_MM,
  LIP_VOLUME_ML,
  NOSE_LEVELS,
  cornerDegrees,
  formatMm,
  resolveScale,
  visibleCreaseMm,
} from "./lib/params";
import { rasterToCanvas, simulateFront, simulateSide, withFooter } from "./lib/simulate";
import type { Facing, Level, Raster, SimRequest } from "./lib/types";
import { DISCLAIMER } from "./lib/types";

type Photo = {
  name: string;
  url: string;
  image: HTMLImageElement;
  raster: Raster;
};

type Results = {
  front: string;
  frontDownload: string;
  side: string;
  sideDownload: string;
  generatedAt: string;
};

type AppState = {
  loggedIn: boolean;
  step: 1 | 2 | 3 | 4;
  front: Photo | null;
  side: Photo | null;
  videoName: string | null;
  detection: Detection | null;
  detecting: boolean;
  sideFacing: Facing;
  intercanthalMm: number | null;
  request: Omit<SimRequest, "pxPerMm">;
  results: Results | null;
  compareView: "front" | "side";
  compareValue: number;
  busy: boolean;
  notice: string | null;
};

const state: AppState = {
  // 调试阶段直接进入采集页；恢复登录时改回 false 即可。
  loggedIn: true,
  step: 1,
  front: null,
  side: null,
  videoName: null,
  detection: null,
  detecting: false,
  sideFacing: "left",
  intercanthalMm: null,
  request: {
    procedures: { eyelid: true, nose: true, lip: true, corner: true },
    eyelidLevel: "typical",
    eyelidStyle: "infold",
    noseLevel: "typical",
    lipLevel: "typical",
    cornerMode: "injection",
    cornerLevel: "typical",
  },
  results: null,
  compareView: "front",
  compareValue: 52,
  busy: false,
  notice: null,
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const levelNames: Record<Level, string> = { mild: "轻度", typical: "常见", strong: "明显" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function getScale() {
  return resolveScale({
    irisDiameterPx: state.detection?.irisDiameterPx ?? null,
    intercanthalPx: state.detection?.intercanthalPx ?? null,
    intercanthalMm: state.intercanthalMm,
    faceWidthPx: state.front?.raster.width ?? 720,
  });
}

function levelControl(
  target: "eyelidLevel" | "noseLevel" | "lipLevel" | "cornerLevel",
  current: Level,
  values: Record<Level, string>,
  disabled = false,
): string {
  return `<div class="segmented three" role="group" aria-label="效果档位">
    ${(["mild", "typical", "strong"] as Level[])
      .map(
        (level) => `<button type="button" class="${current === level ? "active" : ""}" data-level="${target}" data-value="${level}" ${disabled ? "disabled" : ""}>
          <span>${levelNames[level]}</span><small>${values[level]}</small>
        </button>`,
      )
      .join("")}
  </div>`;
}

function renderLogin(): string {
  return `<main class="login-shell">
    <section class="login-story">
      <div class="brand light"><span class="brand-mark">澄</span><span>澄境咨询台</span></div>
      <div class="story-copy">
        <p class="eyebrow">AESTHETIC CONSULTATION</p>
        <h1>把每一次沟通<br>变得更清晰。</h1>
        <p>以可控参数演示术后方向，保留原始特征，让医生与顾客围绕同一张图沟通。</p>
      </div>
      <div class="story-foot"><span>本地处理</span><i></i><span>参数可追溯</span><i></i><span>结果带声明</span></div>
    </section>
    <section class="login-panel">
      <form id="login-form" class="login-card">
        <div class="mobile-brand brand"><span class="brand-mark">澄</span><span>澄境咨询台</span></div>
        <p class="eyebrow ink">INTERNAL ACCESS</p>
        <h2>工作人员登录</h2>
        <p class="muted">仅供诊所内部咨询演示使用</p>
        <label>工号<input name="user" autocomplete="username" value="consultant" required></label>
        <label>访问码<input name="code" type="password" autocomplete="current-password" value="clinic-demo" required></label>
        <p id="login-error" class="form-error" hidden>工号或访问码不正确</p>
        <button class="primary wide" type="submit">进入咨询台 <span>→</span></button>
        <p class="demo-credential">演示账号：consultant · 访问码：clinic-demo</p>
      </form>
    </section>
  </main>`;
}

const stepLabels = ["采集影像", "选择参数", "生成预览", "前后对比"];

function shell(content: string): string {
  return `<div class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">澄</span><span>澄境咨询台</span><em>内部演示</em></div>
      <div class="session-meta"><span class="privacy-dot"></span>影像仅在本机处理 <span class="divider"></span> 操作员：李顾问 <span class="debug-badge">调试模式</span></div>
    </header>
    <div class="workspace">
      <aside class="sidebar">
        <div class="case-label">本次咨询</div>
        <strong>访客 · ${new Date().toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</strong>
        <nav class="steps">
          ${stepLabels
            .map((label, index) => {
              const n = index + 1;
              const stateClass = state.step === n ? "current" : state.step > n ? "done" : "";
              return `<button data-step="${n}" class="${stateClass}" ${n > state.step && (n === 4 ? !state.results : n > 2) ? "disabled" : ""}>
                <span>${state.step > n ? "✓" : String(n).padStart(2, "0")}</span><b>${label}</b>
              </button>`;
            })
            .join("")}
        </nav>
        <div class="side-help"><span>?</span><div><b>需要帮助？</b><small>拍摄时保持自然表情与均匀光线</small></div></div>
      </aside>
      <main class="content">${content}</main>
    </div>
    <div class="legal-bar"><span>演示系统不会生成医疗方案</span><strong>${DISCLAIMER}</strong></div>
    ${state.notice ? `<div class="toast">${escapeHtml(state.notice)}</div>` : ""}
  </div>`;
}

function pageHead(kicker: string, title: string, copy: string): string {
  return `<div class="page-head"><div><p class="eyebrow ink">${kicker}</p><h1>${title}</h1><p>${copy}</p></div><div class="step-count"><b>0${state.step}</b><span>/ 04</span></div></div>`;
}

function uploadCard(kind: "front" | "side"): string {
  const photo = kind === "front" ? state.front : state.side;
  const title = kind === "front" ? "正脸照片" : "侧脸照片";
  const tip = kind === "front" ? "平视镜头，完整露出眉、眼、鼻、唇" : "头部转至 90°，露出鼻尖与下巴轮廓";
  return `<article class="upload-card ${photo ? "has-photo" : ""}">
    <div class="upload-preview">
      ${photo ? `<img src="${photo.url}" alt="${title}预览">` : `<div class="face-guide ${kind}"><span></span></div>`}
      <div class="view-tag">${kind === "front" ? "FRONT · 0°" : "PROFILE · 90°"}</div>
      ${photo ? `<div class="photo-ok">✓ 已就绪</div>` : ""}
    </div>
    <div class="upload-copy">
      <div><h3>${title}<sup>必需</sup></h3><p>${tip}</p></div>
      <div class="upload-actions">
        <label class="secondary"><input id="${kind}-file" type="file" accept="image/*" hidden>上传照片</label>
        <button class="text-button" data-camera="${kind}" type="button">使用相机</button>
      </div>
    </div>
  </article>`;
}

function renderCapture(): string {
  const ready = Boolean(state.front && state.side);
  return shell(`${pageHead("STEP 01 · CAPTURE", "采集面部影像", "请准备一张正脸和一张侧脸照片。影像只保留在本次浏览器会话中。")}
    <div class="capture-toolbar">
      <div class="quality-tip"><span>☼</span><p><b>拍摄提示</b> 使用正面柔光、自然表情；摘下眼镜并露出完整发际线。</p></div>
      <button id="use-sample" class="ghost" type="button">使用示例影像</button>
    </div>
    <div class="capture-grid">${uploadCard("front")}${uploadCard("side")}</div>
    <section class="video-row">
      <div class="video-icon">◫</div>
      <div><b>可选：环绕短视频</b><p>用于后续三维预览。本版会记录素材并自动使用二维结果作为稳定回退。</p></div>
      <label class="secondary compact"><input id="video-file" type="file" accept="video/*" hidden>${state.videoName ? "更换视频" : "添加视频"}</label>
      ${state.videoName ? `<span class="file-pill">${escapeHtml(state.videoName)}</span>` : ""}
    </section>
    <section class="calibration-row">
      <div><b>比例标定</b><p>${state.detecting ? "正在定位面部标志点…" : state.detection?.source === "mediapipe" ? "已通过虹膜标志点自动标定" : "可填写实际内眦间距，提高毫米显示可信度"}</p></div>
      <label>内眦间距（可选）<span><input id="icd-mm" type="number" min="20" max="50" step="0.5" value="${state.intercanthalMm ?? ""}" placeholder="例如 34"> mm</span></label>
      <div class="calibration-status ${getScale().calibrated ? "calibrated" : ""}">${getScale().calibrated ? "✓ 已标定" : "相对幅度"}</div>
    </section>
    <footer class="page-actions"><span>${ready ? "两张影像已就绪，可以继续" : "请添加正脸和侧脸影像"}</span><button id="capture-next" class="primary" ${!ready || state.detecting ? "disabled" : ""}>选择模拟项目 <span>→</span></button></footer>`);
}

function toggle(id: keyof SimRequest["procedures"], title: string, sub: string): string {
  return `<label class="procedure-toggle"><span><b>${title}</b><small>${sub}</small></span><input type="checkbox" data-procedure="${id}" ${state.request.procedures[id] ? "checked" : ""}><i></i></label>`;
}

function renderParameters(): string {
  const scale = getScale();
  const mm = (n: number) => formatMm(n, scale.calibrated);
  const cornerDisabled = !state.request.procedures.corner || state.request.cornerMode === "injection";
  return shell(`${pageHead("STEP 02 · PARAMETERS", "选择模拟参数", "每项只提供轻度、常见与明显三档。参数用于视觉沟通，不构成治疗建议。")}
    ${scale.warning ? `<div class="warning-banner">${escapeHtml(scale.warning)}</div>` : ""}
    <div class="parameter-grid">
      <article class="procedure-card ${state.request.procedures.eyelid ? "selected" : ""}">
        <div class="card-num">01</div>${toggle("eyelid", "双眼皮", "睁眼褶皱预览")}
        <div class="card-body">
          <p class="field-label">闭眼设计高度 <span>睁眼可见 ${scale.calibrated ? `${visibleCreaseMm(EYELID_DESIGN_MM[state.request.eyelidLevel]).toFixed(1)} mm` : "相对幅度"}</span></p>
          ${levelControl("eyelidLevel", state.request.eyelidLevel, { mild: mm(6), typical: mm(7), strong: mm(8) }, !state.request.procedures.eyelid)}
          <p class="field-label">褶皱形态</p>
          <div class="segmented two">
            <button data-style="infold" class="${state.request.eyelidStyle === "infold" ? "active" : ""}">开扇<small>内侧收窄</small></button>
            <button data-style="parallel" class="${state.request.eyelidStyle === "parallel" ? "active" : ""}">平行<small>宽度较均匀</small></button>
          </div>
        </div>
      </article>
      <article class="procedure-card ${state.request.procedures.nose ? "selected" : ""}">
        <div class="card-num">02</div>${toggle("nose", "隆鼻", "正侧脸联合预览")}
        <div class="card-body">
          <p class="field-label">鼻背增高 <span>Goode 目标 0.60</span></p>
          ${levelControl("noseLevel", state.request.noseLevel, {
            mild: `+${mm(2)}`, typical: `+${mm(3.5)}`, strong: `+${mm(5)}`,
          }, !state.request.procedures.nose)}
          <div class="metric-strip"><span>鼻翼内收 <b>${mm(NOSE_LEVELS[state.request.noseLevel].alarMm)}</b></span><span>鼻唇角 <b>约 98°</b></span></div>
        </div>
      </article>
      <article class="procedure-card ${state.request.procedures.lip ? "selected" : ""}">
        <div class="card-num">03</div>${toggle("lip", "丰唇", "红唇体积与前突")}
        <div class="card-body">
          <p class="field-label">双唇合计容量 <span>上 : 下约 1 : 1.6</span></p>
          ${levelControl("lipLevel", state.request.lipLevel, { mild: "0.8 mL", typical: "1.0 mL", strong: "1.2 mL" }, !state.request.procedures.lip)}
          <div class="metric-strip"><span>侧脸前突 <b>${scale.calibrated ? "约 +1 mm" : "相对幅度"}</b></span><span>口角 <b>保持不动</b></span></div>
        </div>
      </article>
      <article class="procedure-card ${state.request.procedures.corner ? "selected" : ""}">
        <div class="card-num">04</div>${toggle("corner", "嘴角上扬", "与丰唇独立控制")}
        <div class="card-body">
          <p class="field-label">演示方式 <span>两套幅度不混用</span></p>
          <div class="segmented two">
            <button data-corner-mode="injection" class="${state.request.cornerMode === "injection" ? "active" : ""}">注射档<small>固定约 +2°</small></button>
            <button data-corner-mode="surgery" class="${state.request.cornerMode === "surgery" ? "active" : ""}">手术档<small>按外侧支控制</small></button>
          </div>
          ${levelControl("cornerLevel", state.request.cornerLevel, {
            mild: state.request.cornerMode === "injection" ? "+2°" : "1 mm · +3°",
            typical: state.request.cornerMode === "injection" ? "+2°" : "3 mm · +5°",
            strong: state.request.cornerMode === "injection" ? "+2°" : "5 mm · +7°",
          }, cornerDisabled)}
        </div>
      </article>
    </div>
    <details class="catalog">
      <summary><span>完整参数目录</span><small>已收录，后续版本开放模拟</small></summary>
      <div>${["上睑下垂", "开内眼角", "开外眼角", "泪沟", "鼻背降低", "唇提升", "唇外翻", "木偶纹", "垫下巴", "颧骨内推", "V-line", "眉提升", "发际线降低"].map((x) => `<span>${x}<i>后续</i></span>`).join("")}</div>
    </details>
    <footer class="page-actions"><button class="back" data-step="1">← 返回采集</button><span>${scale.calibrated ? "当前毫米数已按影像比例标定" : "当前以相对幅度生成，结果中隐藏绝对毫米"}</span><button id="generate" class="primary" ${Object.values(state.request.procedures).every((v) => !v) ? "disabled" : ""}>生成模拟预览 <span>→</span></button></footer>`);
}

function resultFigure(kind: "front" | "side", compact = false): string {
  if (!state.results) return "";
  const title = kind === "front" ? "正脸模拟" : "侧脸模拟";
  const original = kind === "front" ? state.front!.url : state.side!.url;
  const result = kind === "front" ? state.results.front : state.results.side;
  return `<figure class="result-figure ${compact ? "compact" : ""}">
    <div class="result-image"><img src="${result}" alt="${title}"><span class="result-label">SIMULATION · ${kind === "front" ? "FRONT" : "PROFILE"}</span></div>
    <figcaption><div><b>${title}</b><span>${kind === "front" ? "眼睑 · 鼻翼 · 唇部 · 口角" : "鼻背 · 鼻尖 · 唇部前突"}</span></div><button class="compare-mini" data-quick-compare="${kind}" data-original="${original}">查看原图</button></figcaption>
  </figure>`;
}

function parameterReceipt(): string {
  const scale = getScale();
  const items: string[] = [];
  if (state.request.procedures.eyelid) items.push(`双眼皮 · ${levelNames[state.request.eyelidLevel]} · ${state.request.eyelidStyle === "infold" ? "开扇" : "平行"} · ${formatMm(EYELID_DESIGN_MM[state.request.eyelidLevel], scale.calibrated)}`);
  if (state.request.procedures.nose) items.push(`隆鼻 · ${levelNames[state.request.noseLevel]} · 鼻背 ${formatMm(NOSE_LEVELS[state.request.noseLevel].dorsumMm, scale.calibrated)}`);
  if (state.request.procedures.lip) items.push(`丰唇 · ${LIP_VOLUME_ML[state.request.lipLevel].toFixed(1)} mL · 上下唇 1:1.6`);
  if (state.request.procedures.corner) {
    const mode = state.request.cornerMode === "injection" ? "注射档" : "手术档";
    const limb = state.request.cornerMode === "surgery" ? ` · 外侧支 ${surgeryLimb(state.request.cornerLevel)} mm` : "";
    items.push(`嘴角上扬 · ${mode} · +${cornerDegrees(state.request.cornerMode, state.request.cornerLevel)}°${limb}`);
  }
  return `<div class="receipt"><div class="receipt-head"><span>本次参数回执</span><b>${scale.calibrated ? "已标定" : "相对幅度"}</b></div>${items.map((item) => `<p><i>✓</i>${item}</p>`).join("")}</div>`;
}

function renderPreview(): string {
  return shell(`${pageHead("STEP 03 · PREVIEW", "模拟结果预览", "几何变化由已选参数直接控制，编辑区域外保留原始像素。")}
    ${state.busy ? `<div class="generating"><div class="scan-face"><span></span></div><h2>正在生成可控模拟</h2><p>定位标志点 · 编译参数 · 局部几何形变 · 添加高光阴影</p><div class="progress"><i></i></div></div>` : `<div class="preview-layout">
      <div class="result-grid">${resultFigure("front")}${resultFigure("side")}</div>
      <aside class="preview-aside">${parameterReceipt()}<div class="method-note"><span>◇</span><p><b>局部几何模拟</b>本次结果由标志点与相似移动最小二乘生成，没有使用生成模型自由改脸。</p></div></aside>
    </div>
    <footer class="page-actions"><button class="back" data-step="2">← 调整参数</button><span>生成于 ${state.results?.generatedAt ?? ""}</span><button id="to-compare" class="primary">进入前后对比 <span>→</span></button></footer>`}`);
}

function renderComparison(): string {
  if (!state.results || !state.front || !state.side) return renderPreview();
  const kind = state.compareView;
  const original = kind === "front" ? state.front.url : state.side.url;
  const after = kind === "front" ? state.results.front : state.results.side;
  return shell(`${pageHead("STEP 04 · COMPARE", "术前 / 模拟对比", "拖动分隔线查看局部变化，并下载带模拟声明的咨询图。")}
    <div class="compare-tabs"><button data-view="front" class="${kind === "front" ? "active" : ""}">正脸对比</button><button data-view="side" class="${kind === "side" ? "active" : ""}">侧脸对比</button></div>
    <div class="compare-layout">
      <section class="compare-stage">
        <div class="compare-frame">
          <img src="${original}" alt="术前原图">
          <div class="after-layer" style="clip-path: inset(0 ${100 - state.compareValue}% 0 0)"><img src="${after}" alt="模拟结果"></div>
          <span class="before-tag">术前</span><span class="after-tag">模拟后</span>
          <div class="compare-line" style="left:${state.compareValue}%"><i>‹ ›</i></div>
          <input id="compare-range" type="range" min="0" max="100" value="${state.compareValue}" aria-label="术前术后对比位置">
        </div>
        <div class="image-disclaimer">${DISCLAIMER}</div>
      </section>
      <aside class="compare-aside">${parameterReceipt()}
        <button id="download" class="primary wide">下载带声明结果图 ↓</button>
        <button id="new-session" class="secondary wide">开始新的咨询</button>
        <p class="save-note">结果图仅下载至本机，不生成公开分享链接。</p>
      </aside>
    </div>
    <footer class="page-actions"><button class="back" data-step="3">← 返回预览</button><span>请结合面诊和专业评估说明结果</span></footer>`);
}

function render(): void {
  app!.innerHTML = state.loggedIn
    ? state.step === 1
      ? renderCapture()
      : state.step === 2
        ? renderParameters()
        : state.step === 3
          ? renderPreview()
          : renderComparison()
    : renderLogin();
  bindEvents();
}

function bindEvents(): void {
  document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    if (data.get("user") === "consultant" && data.get("code") === "clinic-demo") {
      state.loggedIn = true;
      render();
    } else {
      document.querySelector<HTMLElement>("#login-error")!.hidden = false;
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!button.disabled) {
        state.step = Number(button.dataset.step) as AppState["step"];
        render();
      }
    }),
  );
  for (const kind of ["front", "side"] as const) {
    document.querySelector<HTMLInputElement>(`#${kind}-file`)?.addEventListener("change", async (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (file) await setPhoto(kind, await photoFromFile(file));
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-camera]").forEach((button) =>
    button.addEventListener("click", () => openCamera(button.dataset.camera as "front" | "side")),
  );
  document.querySelector("#use-sample")?.addEventListener("click", useSample);
  document.querySelector<HTMLInputElement>("#video-file")?.addEventListener("change", (event) => {
    state.videoName = (event.currentTarget as HTMLInputElement).files?.[0]?.name ?? null;
    render();
  });
  document.querySelector<HTMLInputElement>("#icd-mm")?.addEventListener("change", (event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    state.intercanthalMm = Number.isFinite(value) && value >= 20 && value <= 50 ? value : null;
    render();
  });
  document.querySelector("#capture-next")?.addEventListener("click", () => {
    state.step = 2;
    render();
  });
  document.querySelectorAll<HTMLInputElement>("[data-procedure]").forEach((input) =>
    input.addEventListener("change", () => {
      state.request.procedures[input.dataset.procedure as keyof SimRequest["procedures"]] = input.checked;
      state.results = null;
      render();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((button) =>
    button.addEventListener("click", () => {
      const target = button.dataset.level as "eyelidLevel" | "noseLevel" | "lipLevel" | "cornerLevel";
      state.request[target] = button.dataset.value as Level;
      state.results = null;
      render();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-style]").forEach((button) =>
    button.addEventListener("click", () => {
      state.request.eyelidStyle = button.dataset.style as SimRequest["eyelidStyle"];
      state.results = null;
      render();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-corner-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      state.request.cornerMode = button.dataset.cornerMode as SimRequest["cornerMode"];
      state.results = null;
      render();
    }),
  );
  document.querySelector("#generate")?.addEventListener("click", generateResults);
  document.querySelector("#to-compare")?.addEventListener("click", () => {
    state.step = 4;
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
      state.compareView = button.dataset.view as "front" | "side";
      render();
    }),
  );
  document.querySelector<HTMLInputElement>("#compare-range")?.addEventListener("input", (event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    state.compareValue = value;
    const layer = document.querySelector<HTMLElement>(".after-layer");
    const line = document.querySelector<HTMLElement>(".compare-line");
    if (layer) layer.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    if (line) line.style.left = `${value}%`;
  });
  document.querySelector("#download")?.addEventListener("click", downloadCurrent);
  document.querySelector("#new-session")?.addEventListener("click", resetSession);
  document.querySelectorAll<HTMLButtonElement>("[data-quick-compare]").forEach((button) => {
    let showingOriginal = false;
    button.addEventListener("click", () => {
      const img = button.closest("figure")?.querySelector<HTMLImageElement>(".result-image img");
      if (!img || !state.results) return;
      const kind = button.dataset.quickCompare as "front" | "side";
      showingOriginal = !showingOriginal;
      img.src = showingOriginal ? button.dataset.original! : kind === "front" ? state.results.front : state.results.side;
      button.textContent = showingOriginal ? "查看模拟" : "查看原图";
    });
  });
}

async function setPhoto(kind: "front" | "side", photo: Photo): Promise<void> {
  if (kind === "front") {
    state.front = photo;
    state.detecting = true;
    state.detection = null;
    render();
    const canvas = rasterToCanvas(photo.raster);
    const detected = await detectFront(canvas, photo.raster.width, photo.raster.height);
    state.detection = detected ?? {
      face: defaultFront(photo.raster.width, photo.raster.height),
      irisDiameterPx: null,
      intercanthalPx: photo.raster.width * 0.22,
      source: "fallback",
    };
    state.detecting = false;
  } else {
    state.side = photo;
  }
  state.results = null;
  render();
}

async function photoFromFile(file: File): Promise<Photo> {
  const url = URL.createObjectURL(file);
  const image = await loadImage(url);
  const max = 960;
  const ratio = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const displayUrl = canvas.toDataURL("image/jpeg", 0.92);
  return {
    name: file.name,
    url: displayUrl,
    image: await loadImage(displayUrl),
    raster: { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data },
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function photoFromCanvas(canvas: HTMLCanvasElement, name: string): Promise<Photo> {
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const url = canvas.toDataURL("image/jpeg", 0.94);
  return {
    name,
    url,
    image: await loadImage(url),
    raster: { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data },
  };
}

function roundedEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: CanvasGradient | string): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawFrontSample(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 840;
  const ctx = canvas.getContext("2d")!;
  const bg = ctx.createLinearGradient(0, 0, 720, 840);
  bg.addColorStop(0, "#d8d3c8");
  bg.addColorStop(1, "#a9b4ad");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 720, 840);
  ctx.fillStyle = "#252a29";
  ctx.beginPath();
  ctx.ellipse(360, 270, 248, 278, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(610, 470);
  ctx.lineTo(112, 470);
  ctx.fill();
  const skin = ctx.createRadialGradient(315, 300, 30, 360, 420, 370);
  skin.addColorStop(0, "#f2cbbb");
  skin.addColorStop(0.72, "#dcae9e");
  skin.addColorStop(1, "#bc887c");
  roundedEllipse(ctx, 360, 420, 215, 315, skin);
  roundedEllipse(ctx, 145, 426, 31, 70, "#d49f91");
  roundedEllipse(ctx, 575, 426, 31, 70, "#d49f91");
  ctx.strokeStyle = "#403632";
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(215, 294); ctx.quadraticCurveTo(275, 272, 322, 292);
  ctx.moveTo(398, 292); ctx.quadraticCurveTo(447, 271, 505, 294);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(213, 342); ctx.quadraticCurveTo(267, 316, 319, 344); ctx.quadraticCurveTo(267, 370, 213, 342);
  ctx.moveTo(401, 344); ctx.quadraticCurveTo(453, 316, 507, 342); ctx.quadraticCurveTo(453, 370, 401, 344);
  ctx.fillStyle = "#f7ece6"; ctx.fill(); ctx.stroke();
  roundedEllipse(ctx, 269, 343, 17, 17, "#493c35");
  roundedEllipse(ctx, 451, 343, 17, 17, "#493c35");
  roundedEllipse(ctx, 269, 343, 6, 6, "#161817");
  roundedEllipse(ctx, 451, 343, 6, 6, "#161817");
  ctx.strokeStyle = "rgba(133,83,70,.45)";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(360, 355); ctx.quadraticCurveTo(336, 430, 352, 468); ctx.quadraticCurveTo(360, 480, 379, 466); ctx.stroke();
  ctx.fillStyle = "#b0696d";
  ctx.beginPath(); ctx.moveTo(270, 564); ctx.quadraticCurveTo(323, 530, 360, 550); ctx.quadraticCurveTo(397, 530, 450, 564); ctx.quadraticCurveTo(398, 600, 360, 596); ctx.quadraticCurveTo(318, 600, 270, 564); ctx.fill();
  ctx.strokeStyle = "rgba(100,48,52,.45)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(278, 565); ctx.quadraticCurveTo(360, 577, 442, 565); ctx.stroke();
  return canvas;
}

function drawSideSample(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 840;
  const ctx = canvas.getContext("2d")!;
  const bg = ctx.createLinearGradient(0, 0, 720, 840);
  bg.addColorStop(0, "#c9d0ca");
  bg.addColorStop(1, "#899d96");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 720, 840);
  ctx.fillStyle = "#282e2d";
  ctx.beginPath(); ctx.ellipse(405, 320, 230, 300, -0.1, 0, Math.PI * 2); ctx.fill();
  const skin = ctx.createLinearGradient(220, 150, 560, 720);
  skin.addColorStop(0, "#efc5b4"); skin.addColorStop(1, "#ba8578");
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(445, 135); ctx.quadraticCurveTo(325, 150, 308, 280);
  ctx.quadraticCurveTo(300, 322, 274, 365); ctx.lineTo(224, 420);
  ctx.quadraticCurveTo(207, 446, 266, 454); ctx.quadraticCurveTo(298, 465, 269, 500);
  ctx.quadraticCurveTo(240, 520, 278, 539); ctx.quadraticCurveTo(304, 551, 273, 574);
  ctx.quadraticCurveTo(251, 593, 294, 615); ctx.quadraticCurveTo(350, 652, 426, 674);
  ctx.quadraticCurveTo(500, 630, 548, 543); ctx.lineTo(570, 190); ctx.quadraticCurveTo(518, 130, 445, 135); ctx.fill();
  ctx.strokeStyle = "#403632"; ctx.lineWidth = 12; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(315, 302); ctx.quadraticCurveTo(352, 281, 389, 301); ctx.stroke();
  ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(308, 344); ctx.quadraticCurveTo(348, 327, 383, 348); ctx.stroke();
  roundedEllipse(ctx, 339, 342, 10, 11, "#372e2b");
  ctx.strokeStyle = "#a75f64"; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(268, 535); ctx.quadraticCurveTo(246, 548, 280, 554); ctx.moveTo(280, 557); ctx.quadraticCurveTo(246, 569, 283, 576); ctx.stroke();
  return canvas;
}

async function useSample(): Promise<void> {
  state.front = await photoFromCanvas(drawFrontSample(), "示例正脸.jpg");
  state.side = await photoFromCanvas(drawSideSample(), "示例侧脸.jpg");
  state.detection = {
    face: defaultFront(state.front.raster.width, state.front.raster.height),
    irisDiameterPx: null,
    intercanthalPx: state.front.raster.width * 0.22,
    source: "fallback",
  };
  state.results = null;
  state.notice = "示例影像已载入，可直接体验完整流程";
  render();
  window.setTimeout(() => {
    state.notice = null;
    document.querySelector(".toast")?.remove();
  }, 2600);
}

async function openCamera(kind: "front" | "side"): Promise<void> {
  let stream: MediaStream | null = null;
  const dialog = document.createElement("dialog");
  dialog.className = "camera-dialog";
  dialog.innerHTML = `<div class="camera-head"><div><b>拍摄${kind === "front" ? "正脸" : "侧脸"}</b><span>${kind === "front" ? "请平视镜头" : "请转向一侧"}</span></div><button aria-label="关闭">×</button></div><video autoplay playsinline></video><div class="camera-actions"><button class="shutter"><i></i></button><span>点击拍摄</span></div>`;
  document.body.append(dialog);
  const stop = () => {
    stream?.getTracks().forEach((track) => track.stop());
    dialog.remove();
  };
  dialog.querySelector("button")!.addEventListener("click", stop);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 } }, audio: false });
    const video = dialog.querySelector("video")!;
    video.srcObject = stream;
    dialog.showModal();
    dialog.querySelector(".shutter")!.addEventListener("click", async () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 840;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      stop();
      await setPhoto(kind, await photoFromCanvas(canvas, `${kind}-camera.jpg`));
    });
  } catch {
    stop();
    state.notice = "无法访问相机，请检查浏览器权限或改用上传照片";
    render();
  }
}

function rasterDataUrl(raster: Raster): string {
  return rasterToCanvas(raster).toDataURL("image/png");
}

async function generateResults(): Promise<void> {
  if (!state.front || !state.side || !state.detection) return;
  state.step = 3;
  state.busy = true;
  render();
  await new Promise((resolve) => window.setTimeout(resolve, 520));
  const scale = getScale();
  const request: SimRequest = { ...state.request, procedures: { ...state.request.procedures }, pxPerMm: scale.pxPerMm };
  const frontRaster = simulateFront(state.front.raster, state.detection.face, request);
  const sideShape = defaultSide(state.side.raster.width, state.side.raster.height, state.sideFacing);
  const sideRaster = simulateSide(state.side.raster, sideShape, request);
  state.results = {
    front: rasterDataUrl(frontRaster),
    frontDownload: rasterDataUrl(withFooter(frontRaster)),
    side: rasterDataUrl(sideRaster),
    sideDownload: rasterDataUrl(withFooter(sideRaster)),
    generatedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
  };
  state.busy = false;
  render();
}

function downloadCurrent(): void {
  if (!state.results) return;
  const link = document.createElement("a");
  link.href = state.compareView === "front" ? state.results.frontDownload : state.results.sideDownload;
  link.download = `医美模拟-${state.compareView === "front" ? "正脸" : "侧脸"}-${Date.now()}.png`;
  link.click();
}

function resetSession(): void {
  state.step = 1;
  state.front = null;
  state.side = null;
  state.videoName = null;
  state.detection = null;
  state.intercanthalMm = null;
  state.results = null;
  state.compareValue = 52;
  render();
}

render();
