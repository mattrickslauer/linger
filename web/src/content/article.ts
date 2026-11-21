// Demo reading: original text, written for Linger. Deliberately dense with jargon so the
// "stuck" path has something real to do.

export type Block =
  | { kind: "p"; id: string; text: string }
  | { kind: "figure"; id: string; caption: string; svg: string };

export interface Doc {
  title: string;
  byline: string;
  blocks: Block[];
}

const duckCurve = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 340" role="img" aria-label="Net load over one spring day, 2016 versus 2026">
  <rect width="640" height="340" fill="#ffffff"/>
  <g font-family="Atkinson Hyperlegible Next, Arial, sans-serif" font-size="13" fill="#1E2742">
    <text x="320" y="24" text-anchor="middle" font-size="15" font-weight="700">Net load on a spring day (gigawatts)</text>
    <line x1="60" y1="290" x2="610" y2="290" stroke="#1E2742"/>
    <line x1="60" y1="40" x2="60" y2="290" stroke="#1E2742"/>
    <text x="52" y="294" text-anchor="end">10</text>
    <text x="52" y="211" text-anchor="end">15</text>
    <text x="52" y="128" text-anchor="end">20</text>
    <text x="52" y="45" text-anchor="end">25</text>
    <line x1="60" y1="207" x2="610" y2="207" stroke="#c9cfdb" stroke-dasharray="3 4"/>
    <line x1="60" y1="124" x2="610" y2="124" stroke="#c9cfdb" stroke-dasharray="3 4"/>
    <text x="60" y="310" text-anchor="middle">0:00</text>
    <text x="197" y="310" text-anchor="middle">6:00</text>
    <text x="335" y="310" text-anchor="middle">12:00</text>
    <text x="472" y="310" text-anchor="middle">18:00</text>
    <text x="610" y="310" text-anchor="middle">24:00</text>
    <text x="335" y="330" text-anchor="middle">Hour of day</text>
  </g>
  <path d="M60 140 C 120 160, 160 170, 197 150 S 260 120, 300 130 S 380 140, 420 120 S 470 70, 500 62 S 570 90, 610 120" fill="none" stroke="#7C879E" stroke-width="3"/>
  <path d="M60 150 C 120 170, 160 180, 197 170 S 260 230, 300 262 S 380 268, 420 230 S 470 80, 500 66 S 570 100, 610 128" fill="none" stroke="#3F57B8" stroke-width="4"/>
  <g font-family="Atkinson Hyperlegible Next, Arial, sans-serif" font-size="13">
    <text x="420" y="104" fill="#5d6780">2016</text>
    <text x="312" y="282" fill="#3F57B8" font-weight="700">2026: the midday "belly"</text>
    <text x="505" y="56" fill="#3F57B8" font-weight="700">evening ramp</text>
  </g>
</svg>`;

export const DEMO_DOC: Doc = {
  title: "Why the grid gets nervous at sunset",
  byline: "A short explainer on how electricity supply and demand are balanced, second by second.",
  blocks: [
    {
      kind: "p",
      id: "p1",
      text: "An electrical grid has almost no storage of its own, so generation must match consumption continuously. When the two drift apart, the imbalance shows up as a change in system frequency: too little supply and the frequency sags below its nominal 60 hertz, too much and it rises. Operators treat that frequency as the grid's pulse.",
    },
    {
      kind: "p",
      id: "p2",
      text: "To hold the pulse steady, balancing authorities procure ancillary services. Primary frequency response comes first, delivered automatically within seconds by generators whose governors react to the deviation itself. Secondary regulation, dispatched through automatic generation control, then restores the frequency and the scheduled interchange with neighbouring areas over the following minutes, while spinning and non-spinning reserves stand by for larger contingencies such as the sudden trip of a large unit.",
    },
    {
      kind: "p",
      id: "p3",
      text: "Solar generation has reshaped the daily shape of the problem. Because rooftop and utility-scale photovoltaics are largely non-dispatchable and sit behind or ahead of the meter in ways operators cannot directly control, what matters for dispatch is net load: total demand minus variable renewable output. On sunny spring days net load collapses around midday and then rebounds steeply as the sun sets and household demand peaks.",
    },
    {
      kind: "figure",
      id: "f1",
      caption: "Net load across one spring day, a decade apart. The deepening midday trough and steep evening rise are known as the duck curve.",
      svg: duckCurve,
    },
    {
      kind: "p",
      id: "p4",
      text: "That evening ramp is the hazard. Thermal plants have minimum stable generation levels and ramp-rate limits, so units that were backed down or decommitted at noon cannot always return fast enough. Operators respond with a mix of curtailment at midday, flexible ramping products in the real-time market, battery energy storage that shifts surplus solar into the evening, and demand response programmes that pay large consumers to defer load.",
    },
    {
      kind: "p",
      id: "p5",
      text: "Storage is changing the economics quickly. A four-hour lithium-ion battery that charges from otherwise-curtailed solar and discharges into the ramp captures the spread between the two prices, and because its inverter can respond in milliseconds it can also sell fast frequency response, a service that synchronous machines provide only through their physical inertia. As inertia declines with fewer spinning generators online, that synthetic response becomes part of how the grid keeps its pulse.",
    },
  ],
};

export function docFromText(raw: string): Doc {
  const paras = raw
    .split(/\n\s*\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
  return {
    title: paras.length > 1 && paras[0].length < 120 ? paras.shift()! : "Your text",
    byline: "",
    blocks: paras.map((text, i) => ({ kind: "p" as const, id: `u${i}`, text })),
  };
}

export function wordCount(b: Block): number {
  return b.kind === "p" ? b.text.split(/\s+/).length : 60;
}
