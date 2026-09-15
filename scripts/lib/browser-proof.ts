import { createRequire } from "node:module";
import { cpus, platform, arch as osArch, totalmem } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./checker-harness.ts";

const WEB_PACKAGE_JSON = join(REPO_ROOT, "apps", "web", "package.json");

export const EVIDENCE_ROOT = join(REPO_ROOT, ".omo", "evidence", "modelshelf-prototype");

export const BROWSER_VERIFIERS = {
  combined: "07-combined-viewer",
  inspection: "08-finding-inspection",
  standalone: join("19-extract-viewer", "standalone"),
  findings: "11-priority-review",
  deliveries: "task-10",
  comparisons: "ticket-15",
} as const;

export type BrowserVerifierId = keyof typeof BROWSER_VERIFIERS;

export function evidenceDir(id: BrowserVerifierId): string {
  return join(EVIDENCE_ROOT, BROWSER_VERIFIERS[id]);
}

export type EvaluateHandle = {
  evaluate<R>(pageFunction: () => R | Promise<R>): Promise<R>;
};

export type ProofHost = {
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly ramBytes: number;
  readonly browserVersion: string;
  readonly webglRenderer: string;
};

export type ProofBrowserLaunchOptions = {
  headless?: boolean;
  ignoreDefaultArgs?: readonly string[];
  args?: readonly string[];
};

export type ChromiumLauncher = {
  launch(options?: ProofBrowserLaunchOptions): Promise<{
    newPage(options?: { viewport?: { width: number; height: number } }): Promise<EvaluateHandle>;
    version(): string;
    close(): Promise<void>;
  }>;
};

export function proofBrowserLaunchOptions(): ProofBrowserLaunchOptions {
  // Playwright injects --disable-gpu in headless, which forces SwiftShader
  // even when the host has hardware GL.
  return {
    headless: true,
    ignoreDefaultArgs: ["--disable-gpu"],
    args: ["--enable-gpu", "--ignore-gpu-blocklist"],
  };
}

type GlContext = {
  getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter(pname: number): unknown;
  RENDERER: number;
};

type CanvasLike = {
  getContext(kind: string): GlContext | null;
};

export async function importChromium(): Promise<{ chromium: ChromiumLauncher }> {
  const requireFromWeb = createRequire(WEB_PACKAGE_JSON);
  const playwright = requireFromWeb("playwright") as { chromium?: ChromiumLauncher };
  if (!playwright.chromium) {
    throw new Error("apps/web playwright export has no chromium launcher");
  }
  return { chromium: playwright.chromium };
}

export async function readProofHost(args: {
  browserVersion: string;
  page: EvaluateHandle;
}): Promise<ProofHost> {
  const cpuModel = cpus()[0]?.model ?? "unavailable: no cpu model";
  const webglRenderer = await args.page.evaluate(readViewerWebGlRenderer);
  return {
    platform: platform(),
    arch: osArch(),
    cpuModel,
    cpuCount: cpus().length,
    ramBytes: totalmem(),
    browserVersion: args.browserVersion,
    webglRenderer,
  };
}

function readViewerWebGlRenderer(): string {
  const view = globalThis as unknown as {
    document: { querySelector(selector: string): CanvasLike | null };
  };
  const canvas =
    view.document.querySelector("[data-review-screen] canvas") ?? view.document.querySelector("canvas");
  if (!canvas) return "unavailable: no canvas";
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return "unavailable: no webgl context";
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  if (ext) {
    const unmasked = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (unmasked) return String(unmasked);
  }
  const fallback = gl.getParameter(gl.RENDERER);
  return String(fallback ?? "unavailable: empty RENDERER");
}
