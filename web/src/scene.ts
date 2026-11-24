// Dev-only: paints stand-in proof frames for fixture Moments on a canvas (no stock photos shipped).
// Output is a real 640 px JPEG at quality 0.6, the same format the recorder produces.

export type SceneKind = "lake" | "cast" | "bass" | "release" | "trail" | "ridge" | "summit" | "screen" | "bench" | "bowl";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const W = 640;
const H = 480;

function sky(g: CanvasRenderingContext2D, top: string, bottom: string, horizon: number) {
  const gr = g.createLinearGradient(0, 0, 0, horizon);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, horizon);
}

function hills(g: CanvasRenderingContext2D, r: () => number, base: number, amp: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 16) g.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x / 90 + r() * 0.4)) - r() * amp * 0.25);
  g.lineTo(W, H);
  g.fill();
}

function water(g: CanvasRenderingContext2D, r: () => number, horizon: number) {
  const gr = g.createLinearGradient(0, horizon, 0, H);
  gr.addColorStop(0, "#5f8e95");
  gr.addColorStop(1, "#1d4650");
  g.fillStyle = gr;
  g.fillRect(0, horizon, W, H - horizon);
  g.strokeStyle = "rgba(230,240,235,0.25)";
  for (let i = 0; i < 60; i++) {
    const y = horizon + 6 + r() * (H - horizon);
    const x = r() * W;
    g.lineWidth = 1 + (y - horizon) / 120;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 20 + r() * 50, y);
    g.stroke();
  }
}

function fish(g: CanvasRenderingContext2D, cx: number, cy: number, len: number, tilt: number) {
  g.save();
  g.translate(cx, cy);
  g.rotate(tilt);
  const body = g.createLinearGradient(0, -len * 0.2, 0, len * 0.2);
  body.addColorStop(0, "#3d5a2a");
  body.addColorStop(0.55, "#7d8f45");
  body.addColorStop(1, "#d9d6a6");
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(0, 0, len * 0.42, len * 0.17, 0, 0, Math.PI * 2);
  g.fill();
  // tail
  g.beginPath();
  g.moveTo(len * 0.38, 0);
  g.lineTo(len * 0.58, -len * 0.14);
  g.lineTo(len * 0.55, 0);
  g.lineTo(len * 0.58, len * 0.14);
  g.closePath();
  g.fillStyle = "#4b6430";
  g.fill();
  // dorsal fin
  g.beginPath();
  g.moveTo(-len * 0.12, -len * 0.15);
  g.quadraticCurveTo(len * 0.05, -len * 0.3, len * 0.22, -len * 0.12);
  g.fillStyle = "#3a5326";
  g.fill();
  // lateral line blotches
  g.fillStyle = "rgba(30,45,20,0.55)";
  for (let i = -4; i <= 4; i++) {
    g.beginPath();
    g.ellipse(i * len * 0.075, 0, len * 0.035, len * 0.025, 0, 0, Math.PI * 2);
    g.fill();
  }
  // big mouth + eye
  g.strokeStyle = "#2a3a18";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-len * 0.42, len * 0.02);
  g.lineTo(-len * 0.3, len * 0.05);
  g.stroke();
  g.fillStyle = "#e9d27a";
  g.beginPath();
  g.arc(-len * 0.31, -len * 0.04, len * 0.028, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#111";
  g.beginPath();
  g.arc(-len * 0.31, -len * 0.04, len * 0.014, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function hand(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = "#c98f6b";
  g.beginPath();
  g.ellipse(x, y, s * 0.16, s * 0.1, -0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#3f5f7a";
  g.fillRect(x - s * 0.1, y + s * 0.05, s * 0.2, H);
}

function vignette(g: CanvasRenderingContext2D) {
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.35)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

function grain(g: CanvasRenderingContext2D, r: () => number) {
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function paint(g: CanvasRenderingContext2D, kind: SceneKind, r: () => number) {
  switch (kind) {
    case "lake":
    case "cast":
    case "bass":
    case "release": {
      const horizon = kind === "bass" ? 170 : 210;
      sky(g, "#a9c3cf", "#f1dcb8", horizon);
      hills(g, r, horizon, 40, "#7e8f86");
      hills(g, r, horizon + 4, 18, "#55685f");
      water(g, r, horizon);
      if (kind === "cast") {
        g.strokeStyle = "#2b2b2b";
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(120, H);
        g.lineTo(380, 120);
        g.stroke();
        g.strokeStyle = "rgba(255,255,255,0.7)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(380, 120);
        g.quadraticCurveTo(500, 110, 560, 260);
        g.stroke();
      }
      if (kind === "bass") {
        hand(g, 190, 300, 360);
        hand(g, 470, 300, 300);
        fish(g, 330, 285, 420, -0.06);
      }
      if (kind === "release") {
        fish(g, 330, 360, 260, 0.25);
        g.fillStyle = "rgba(29,70,80,0.55)";
        g.fillRect(0, 380, W, H - 380);
      }
      break;
    }
    case "trail":
    case "ridge":
    case "summit": {
      const horizon = kind === "summit" ? 300 : 230;
      sky(g, "#6f9cc4", "#dfe9ee", horizon);
      hills(g, r, horizon - 30, 120, "#8494a3");
      hills(g, r, horizon + 40, 90, "#5b6b5a");
      hills(g, r, horizon + 120, 50, "#3c4a35");
      if (kind === "trail") {
        g.fillStyle = "#b59a74";
        g.beginPath();
        g.moveTo(250, H);
        g.quadraticCurveTo(330, 360, 300, 300);
        g.lineTo(312, 300);
        g.quadraticCurveTo(360, 380, 420, H);
        g.fill();
      }
      if (kind === "summit") {
        g.fillStyle = "#6b5a44";
        g.fillRect(300, 150, 10, 200);
        g.fillStyle = "#e7dcc0";
        g.fillRect(250, 150, 140, 54);
        g.fillStyle = "#3a3122";
        g.font = "bold 22px sans-serif";
        g.fillText("SUMMIT 10,064", 258, 186);
      }
      break;
    }
    case "screen": {
      g.fillStyle = "#2c2a2a";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#0d0d0d";
      g.fillRect(70, 50, 500, 330);
      g.save();
      g.beginPath();
      g.rect(84, 62, 472, 300);
      g.clip();
      g.translate(84, 62);
      g.scale(472 / W, 300 / H);
      paint(g, "summit", r);
      g.restore();
      g.strokeStyle = "rgba(255,255,255,0.07)";
      for (let y = 62; y < 362; y += 3) {
        g.beginPath();
        g.moveTo(84, y);
        g.lineTo(556, y + 6);
        g.stroke();
      }
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.beginPath();
      g.moveTo(84, 62);
      g.lineTo(300, 62);
      g.lineTo(84, 250);
      g.fill();
      g.fillStyle = "#1a1a1a";
      g.fillRect(270, 380, 100, 50);
      g.fillStyle = "#4a3f36";
      g.fillRect(0, 430, W, 50);
      break;
    }
    case "bench":
    case "bowl": {
      g.fillStyle = "#3d3127";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#8a6a4a";
      g.fillRect(0, 300, W, 180);
      for (let i = 0; i < 12; i++) {
        g.strokeStyle = `rgba(60,40,20,${0.2 + r() * 0.2})`;
        g.beginPath();
        g.moveTo(0, 310 + i * 14 + r() * 6);
        g.lineTo(W, 312 + i * 14 + r() * 6);
        g.stroke();
      }
      const lamp = g.createRadialGradient(420, 120, 10, 420, 120, 380);
      lamp.addColorStop(0, "rgba(255,220,160,0.55)");
      lamp.addColorStop(1, "rgba(255,220,160,0)");
      g.fillStyle = lamp;
      g.fillRect(0, 0, W, H);
      if (kind === "bowl") {
        g.fillStyle = "#c9a37a";
        g.beginPath();
        g.ellipse(320, 300, 170, 40, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.moveTo(150, 300);
        g.quadraticCurveTo(170, 420, 320, 420);
        g.quadraticCurveTo(470, 420, 490, 300);
        g.fill();
        g.fillStyle = "#6e4c30";
        g.beginPath();
        g.ellipse(320, 300, 150, 30, 0, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = "#b08a62";
        g.fillRect(150, 250, 340, 70);
        g.fillStyle = "#e8e0d0";
        for (let i = 0; i < 40; i++) g.fillRect(140 + r() * 360, 320 + r() * 60, 6, 2);
      }
      break;
    }
  }
}

export function paintScene(kind: SceneKind, seed: number): string {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const r = rng(seed);
  paint(g, kind, r);
  vignette(g);
  grain(g, r);
  return c.toDataURL("image/jpeg", 0.6).split(",")[1];
}
