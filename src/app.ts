import {
  acceptRotation,
  createSession,
  evaluate,
  selectRing,
} from "./core/engine.ts";
import examplePuzzle from "../content/examples/rotation-only-v2.json";
import { createDefaultSettings, setAudioEnabled, type UserSettings } from "./core/settings.ts";
import type { CoreSession, Puzzle } from "./core/types.ts";
import { validatePuzzle } from "./core/validation.ts";
import "./app.css";

function render(root: HTMLElement, puzzle: Puzzle): void {
  let session: CoreSession = createSession(puzzle);
  let settings: UserSettings = createDefaultSettings();
  let selectedRing = 0;
  const startedAt = Date.now();

  root.innerHTML = `
    <section class="shell" aria-labelledby="title">
      <h1 id="title">石板回し</h1>
      <p>三本の環を選び、左右へ一区画ずつ回します。</p>
      <div class="status" aria-live="polite">
        <span id="moves">手数: 0</span>
        <span id="light">点灯: 0 / ${puzzle.targets.length}</span>
        <span id="state">操作可能</span>
      </div>
      <fieldset>
        <legend>選択する環</legend>
        <div class="rings" id="rings"></div>
      </fieldset>
      <div class="controls" aria-label="回転操作">
        <button id="left" type="button">左へ回す</button>
        <button id="right" type="button">右へ回す</button>
      </div>
      <label class="setting"><input id="audio" type="checkbox" checked /> 音を有効にする</label>
      <p class="note">盤面表示と問題選択は準備中です。現在は回転と判定の基盤を確認できます。</p>
    </section>
  `;

  const moves = root.querySelector<HTMLElement>("#moves");
  const light = root.querySelector<HTMLElement>("#light");
  const state = root.querySelector<HTMLElement>("#state");
  const rings = root.querySelector<HTMLElement>("#rings");
  const left = root.querySelector<HTMLButtonElement>("#left");
  const right = root.querySelector<HTMLButtonElement>("#right");
  const audio = root.querySelector<HTMLInputElement>("#audio");
  if (!moves || !light || !state || !rings || !left || !right || !audio) return;

  audio.addEventListener("change", () => {
    settings = setAudioEnabled(settings, audio.checked);
  });

  for (let index = 0; index < 3; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ring-button";
    button.textContent = `${index + 1}環`;
    button.setAttribute("aria-pressed", String(index === selectedRing));
    button.addEventListener("click", () => {
      selectedRing = selectRing(selectedRing, index);
      for (const child of Array.from(rings.children)) child.setAttribute("aria-pressed", String(child === button));
    });
    rings.append(button);
  }

  const rotate = (type: "l" | "r"): void => {
    const result = acceptRotation(session, type, selectedRing, Date.now() - startedAt);
    if (!result.accepted) {
      state.textContent = result.reason === "solved" ? "成功済み" : "入力を受け付けません";
      return;
    }
    session = result.session;
    const evaluated = evaluate(puzzle, session.state);
    moves.textContent = `手数: ${session.history.length}`;
    light.textContent = `点灯: ${evaluated.litRequired} / ${evaluated.requiredCount}`;
    state.textContent = evaluated.solved ? "成功" : "操作可能";
    left.disabled = evaluated.solved;
    right.disabled = evaluated.solved;
  };

  left.addEventListener("click", () => rotate("l"));
  right.addEventListener("click", () => rotate("r"));
}

export function boot(root: HTMLElement, definition: unknown): void {
  const result = validatePuzzle(definition);
  if (!result.ok) {
    const path = result.issues[0]?.path ?? "";
    const reason = path.includes("Checksum") || path.includes("checksum")
      ? "問題の内容を確認できません"
      : path.includes("Version") || path.includes("version")
        ? "問題の版を確認できません"
        : "問題の形式を確認できません";
    const section = document.createElement("section");
    section.className = "shell";
    section.setAttribute("role", "alert");
    const heading = document.createElement("h1");
    heading.textContent = "問題を読み込めません";
    const message = document.createElement("p");
    message.textContent = reason;
    section.append(heading, message);
    root.replaceChildren(section);
    return;
  }
  render(root, result.puzzle);
}

const root = document.querySelector<HTMLElement>("#app");
if (root) boot(root, examplePuzzle);
