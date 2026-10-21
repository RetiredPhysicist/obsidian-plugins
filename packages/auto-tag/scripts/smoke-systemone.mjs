#!/usr/bin/env node
/**
 * Tiny System One smoke: 1 note × 2 tags via Noul.
 * Uses JEV_SABRINA_API_KEY or TYPESAFE_API_KEY from env — never hardcode.
 */
const key = process.env.JEV_SABRINA_API_KEY || process.env.TYPESAFE_API_KEY;
const base = (process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai").replace(/\/+$/, "");
const model = process.env.TYPESAFE_MODEL || "jev-1.14.0";

if (!key) {
  console.error("Set JEV_SABRINA_API_KEY or TYPESAFE_API_KEY");
  process.exit(1);
}

const state = {
  note_title: "营销策略",
  note_body:
    "本季度重点投放品牌内容与增长实验：落地页转化、邮件触达、社媒话题。预算分配给 performance 与 brand 两侧。",
};

const questions = {
  t_marketing: {
    type: "noul",
    instructions: 'Should this note be tagged with "#marketing"?',
    criteria: {
      true: 'The note is clearly about marketing.',
      false: 'The note is unrelated to marketing.',
    },
  },
  t_physics: {
    type: "noul",
    instructions: 'Should this note be tagged with "#physics"?',
    criteria: {
      true: 'The note is clearly about physics.',
      false: 'The note is unrelated to physics.',
    },
  },
};

const url = `${base.replace(/\/v1$/i, "")}/v1/systemone`;
console.log("POST", url, "model=", model);

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ model, state, questions }),
});

const text = await res.text();
if (res.status === 402 || /insufficient|credit|quota|billing/i.test(text)) {
  console.error("CREDIT GONE / HTTP", res.status, text.slice(0, 300));
  process.exit(2);
}
if (!res.ok) {
  console.error("HTTP", res.status, text.slice(0, 400));
  process.exit(1);
}

const json = JSON.parse(text);
const m = json.answers?.t_marketing?.noul;
const p = json.answers?.t_physics?.noul;
console.log("marketing noul:", m);
console.log("physics noul:", p);
console.log("usage:", json.usage);
if (typeof m !== "number" || m < 0.5) {
  console.error("Expected marketing noul to be high");
  process.exit(1);
}
console.log("SMOKE OK");
