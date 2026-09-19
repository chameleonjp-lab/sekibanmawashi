import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COUNTDOWN_SECONDS,
  DIFFICULTY_LABEL,
  GAME_TITLE,
  LAB_URL,
  PLAYER_TAG_MAX,
  RING_LABELS,
  ROTATE_ANIM_MS,
  STAGE_CLEAR_MS,
} from "../game/config.ts";
import {
  applyMove,
  cloneState,
  evaluate,
} from "../game/engine.ts";
import { formatTime, sanitizePlayerTag } from "../game/format.ts";
import {
  listLeaderboard,
  prepareRun,
  submitRun,
} from "../game/leaderboard.ts";
import { pickPracticeTicket, puzzlesFromTicket } from "../game/pool.ts";
import {
  loadClientId,
  loadLocalBests,
  loadPendingSubmit,
  loadPlayerTag,
  loadSoundOn,
  recordLocalBest,
  savePendingSubmit,
  savePlayerTag,
  saveSoundOn,
  type LocalBest,
  type PendingSubmit,
} from "../game/storage.ts";
import {
  setSoundEnabled,
  sfxError,
  sfxLit,
  sfxRotate,
  sfxSelect,
  sfxSolve,
  sfxTick,
  sfxToggle,
  unlockAudio,
} from "../game/audio.ts";
import type {
  Action,
  BoardState,
  LeaderboardRow,
  MoveType,
  Puzzle,
  RunMode,
  Screen,
  StageRecord,
} from "../game/types.ts";
import { StoneBoard } from "./StoneBoard.tsx";


function IconVolume({ muted }: { muted: boolean }) {
  return muted ? (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m22 9-6 6M16 9l6 6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a9 9 0 0 1 0 14" />
    </svg>
  );
}

function IconRetry() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

function shareText(title: string, time: string, moves: number): string {
  return `${title} で5つの石板を解きました。合計 ${time} / ${moves}手`;
}

async function shareOrCopy(text: string) {
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

export function GameApp() {
  const reducedMotion = useReducedMotion();
  const [screen, setScreen] = useState<Screen>("home");
  const [howOpen, setHowOpen] = useState(false);
  const [playerTag, setPlayerTag] = useState("");
  const [soundOn, setSoundOn] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<RunMode | null>(null);
  const [runToken, setRunToken] = useState<string | null>(null);
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [stageIndex, setStageIndex] = useState(0);
  const [selectedRing, setSelectedRing] = useState(1);
  const [board, setBoard] = useState<BoardState>({
    rotations: [0, 0, 0],
    emissionEnabled: [true, true, true],
  });
  const [displayRot, setDisplayRot] = useState<[number, number, number]>([0, 0, 0]);
  const [moves, setMoves] = useState(0);
  const [actions, setActions] = useState<Action[]>([]);
  const [stageRecords, setStageRecords] = useState<StageRecord[]>([]);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [playMs, setPlayMs] = useState(0);
  const [lastClear, setLastClear] = useState<{ timeMs: number; moves: number } | null>(null);
  const [abortOpen, setAbortOpen] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "pending" | "ok" | "fail" | "skip">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ranking, setRanking] = useState<LeaderboardRow[]>([]);
  const [localBests, setLocalBests] = useState<LocalBest[]>([]);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSubmit | null>(null);
  const [clientId] = useState(() => (typeof window === "undefined" ? "ssr" : loadClientId()));

  const startRef = useRef<number | null>(null);
  const inputLock = useRef(false);
  const puzzle = puzzles[stageIndex];

  useEffect(() => {
    setPlayerTag(loadPlayerTag());
    const on = loadSoundOn();
    setSoundOn(on);
    setSoundEnabled(on);
    setLocalBests(loadLocalBests());
    setPending(loadPendingSubmit());
    void listLeaderboard()
      .then(setRanking)
      .catch(() => setRanking([]));
  }, []);

  const light = useMemo(() => (puzzle ? evaluate(puzzle, board) : null), [puzzle, board]);

  const tick = useCallback(() => {
    if (startRef.current === null) return;
    setPlayMs(performance.now() - startRef.current);
  }, []);

  useEffect(() => {
    if (screen !== "playing") return;
    let raf = 0;
    const loop = () => {
      tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [screen, tick]);

  const openHow = (from: "home" | "play") => {
    unlockAudio();
    if (from === "play") {
      setHowOpen(true);
      return;
    }
    setScreen("howToPlay");
  };

  const beginRun = async (nextMode: RunMode) => {
    unlockAudio();
    const tag = sanitizePlayerTag(playerTag);
    if (!tag) {
      setNameError("1〜16文字で名前を入力してください");
      sfxError();
      return;
    }
    setNameError(null);
    savePlayerTag(tag);
    setPlayerTag(tag);
    setBusy(true);
    try {
      let ids: string[];
      let token: string | null = null;
      if (nextMode === "challenge") {
        try {
          const prepared = await prepareRun({
            clientInstanceId: clientId,
            playerTag: tag,
          });
          ids = prepared.puzzleIds;
          token = prepared.runToken;
        } catch {
          ids = pickPracticeTicket();
          token = null;
        }
      } else {
        ids = pickPracticeTicket();
      }
      const loaded = puzzlesFromTicket(ids);
      setMode(nextMode);
      setRunToken(token);
      setPuzzles(loaded);
      setStageIndex(0);
      setStageRecords([]);
      setLastClear(null);
      setSubmitState("idle");
      setSubmitError(null);
      loadStage(loaded[0]);
      setCountdown(COUNTDOWN_SECONDS);
      setScreen("countdown");
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "開始できませんでした");
      sfxError();
    } finally {
      setBusy(false);
    }
  };

  const loadStage = (next: Puzzle) => {
    const initial = cloneState(next.initialState);
    setBoard(initial);
    setDisplayRot([...initial.rotations] as [number, number, number]);
    setSelectedRing(1);
    setMoves(0);
    setActions([]);
    setPlayMs(0);
    startRef.current = null;
    inputLock.current = false;
  };

  useEffect(() => {
    if (screen !== "countdown") return;
    setCountdown(COUNTDOWN_SECONDS);
    let n = COUNTDOWN_SECONDS;
    sfxTick();
    const id = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(id);
        startRef.current = performance.now();
        inputLock.current = false;
        setScreen("playing");
        return;
      }
      sfxTick();
      setCountdown(n);
    }, 1000);
    return () => window.clearInterval(id);
  }, [screen, stageIndex]);

  const applyAction = (type: MoveType) => {
    if (screen !== "playing" || !puzzle || inputLock.current) return;
    const ring = selectedRing;
    const started = startRef.current ?? performance.now();
    if (startRef.current === null) startRef.current = started;
    const elapsed = Math.max(0, Math.floor(performance.now() - started));
    const next = applyMove(board, type, ring);
    const prevLit = light?.litRequired ?? 0;
    const nextLight = evaluate(puzzle, next);
    const nextMoves = moves + 1;
    const nextActions: Action[] = [
      ...actions,
      { n: nextMoves, t: elapsed, type, ring },
    ];
    setBoard(next);
    if (type === "l") {
      setDisplayRot((d) => {
        const copy = [...d] as [number, number, number];
        copy[ring] -= 1;
        return copy;
      });
      sfxRotate();
    } else if (type === "r") {
      setDisplayRot((d) => {
        const copy = [...d] as [number, number, number];
        copy[ring] += 1;
        return copy;
      });
      sfxRotate();
    } else {
      sfxToggle(next.emissionEnabled[ring]);
    }
    setMoves(nextMoves);
    setActions(nextActions);
    if (nextLight.litRequired > prevLit) sfxLit();

    if (nextLight.solved) {
      inputLock.current = true;
      const timeMs = elapsed;
      sfxSolve();
      const record: StageRecord = {
        puzzleId: puzzle.id,
        puzzleChecksum: puzzle.contentChecksum,
        timeMs,
        moveCount: nextMoves,
        actions: nextActions,
      };
      const all = [...stageRecords, record];
      setStageRecords(all);
      setLastClear({ timeMs, moves: nextMoves });
      setScreen("stageSolved");
      window.setTimeout(() => {
        if (stageIndex >= puzzles.length - 1) {
          finishRun(all, nextModeSafe());
        } else {
          const upcoming = puzzles[stageIndex + 1];
          setStageIndex(stageIndex + 1);
          loadStage(upcoming);
          setCountdown(COUNTDOWN_SECONDS);
          setScreen("countdown");
        }
      }, reducedMotion ? 400 : STAGE_CLEAR_MS);
    }
  };

  const nextModeSafe = (): RunMode => mode ?? "practice";

  const finishRun = (all: StageRecord[], runMode: RunMode) => {
    startRef.current = null;
    const totalTime = all.reduce((s, x) => s + x.timeMs, 0);
    const totalMoves = all.reduce((s, x) => s + x.moveCount, 0);
    const tag = sanitizePlayerTag(playerTag) ?? playerTag;
    recordLocalBest({
      playerTag: tag,
      totalTimeMs: totalTime,
      totalMoves,
      submittedAt: new Date().toISOString(),
    });
    setLocalBests(loadLocalBests());
    setScreen("runResult");
    if (runMode !== "challenge" || !runToken) {
      setSubmitState("skip");
      return;
    }
    const payload: PendingSubmit = {
      runToken,
      mode: "challenge",
      playerTag: tag,
      clientInstanceId: clientId,
      stages: all,
      totalTimeMs: totalTime,
      totalMoves,
    };
    savePendingSubmit(payload);
    setPending(payload);
    void sendResult(payload);
  };

  const sendResult = async (payload: PendingSubmit) => {
    setSubmitState("pending");
    setSubmitError(null);
    try {
      await submitRun({
        runToken: payload.runToken,
        clientInstanceId: payload.clientInstanceId,
        playerTag: payload.playerTag,
        stages: payload.stages,
        totalTimeMs: payload.totalTimeMs,
        totalMoves: payload.totalMoves,
      });
      savePendingSubmit(null);
      setPending(null);
      setSubmitState("ok");
      const rows = await listLeaderboard();
      setRanking(rows);
    } catch (err) {
      setSubmitState("fail");
      setSubmitError(err instanceof Error ? err.message : "送信に失敗しました");
    }
  };

  const retryPending = () => {
    const pending = loadPendingSubmit();
    if (pending) void sendResult(pending);
  };

  const resetHome = () => {
    setScreen("home");
    setMode(null);
    setPuzzles([]);
    setAbortOpen(false);
    inputLock.current = false;
    startRef.current = null;
  };

  const retryPracticeStage = () => {
    if (mode !== "practice" || !puzzle) return;
    loadStage(puzzle);
    startRef.current = performance.now();
  };

  const onSelectRing = (ring: number) => {
    unlockAudio();
    if (screen !== "playing") {
      setSelectedRing(ring);
      return;
    }
    if (ring !== selectedRing) sfxSelect();
    setSelectedRing(ring);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screen === "playing") {
        if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
          e.preventDefault();
          onSelectRing(Math.max(0, selectedRing - 1));
        } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
          e.preventDefault();
          onSelectRing(Math.min(2, selectedRing + 1));
        } else if (e.key === "1") onSelectRing(0);
        else if (e.key === "2") onSelectRing(1);
        else if (e.key === "3") onSelectRing(2);
        else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
          e.preventDefault();
          applyAction("l");
        } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
          e.preventDefault();
          applyAction("r");
        } else if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          applyAction("t");
        } else if (e.key === "Escape") {
          setAbortOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const totals = stageRecords.reduce(
    (acc, s) => {
      acc.time += s.timeMs;
      acc.moves += s.moveCount;
      return acc;
    },
    { time: 0, moves: 0 },
  );

  return (
    <div className="game-shell">
      {screen === "home" && (
        <HomeScreen
          title={GAME_TITLE}
          playerTag={playerTag}
          onTag={setPlayerTag}
          nameError={nameError}
          busy={busy}
          soundOn={soundOn}
          onToggleSound={() => {
            unlockAudio();
            const next = !soundOn;
            setSoundOn(next);
            saveSoundOn(next);
            setSoundEnabled(next);
          }}
          onChallenge={() => void beginRun("challenge")}
          onPractice={() => void beginRun("practice")}
          onHow={() => openHow("home")}
          onBoard={() => {
            unlockAudio();
            void listLeaderboard()
              .then(setRanking)
              .catch(() => {});
            setScreen("leaderboard");
          }}
          ranking={ranking}
          pending={pending}
          onRetryPending={retryPending}
          onShare={async () => {
            const note = await shareOrCopy(
              `${GAME_TITLE} — 5つの石板を解き、合計時間を競います。`,
            );
            setShareNote(
              note === "copied" ? "文面をコピーしました" : note === "failed" ? "共有できませんでした" : null,
            );
          }}
          shareNote={shareNote}
        />
      )}

      {screen === "howToPlay" && (
        <HowToScreen
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "leaderboard" && (
        <LeaderboardScreen
          ranking={ranking}
          localBests={localBests}
          onBack={() => setScreen("home")}
        />
      )}

      {(screen === "countdown" || screen === "playing" || screen === "stageSolved") && puzzle && (
        <PlayScreen
          screen={screen}
          puzzle={puzzle}
          stageIndex={stageIndex}
          stageCount={puzzles.length}
          board={board}
          displayRot={displayRot}
          selectedRing={selectedRing}
          onSelectRing={onSelectRing}
          onRotate={(dir) => applyAction(dir)}
          onToggle={() => applyAction("t")}
          moves={moves}
          playMs={playMs}
          countdown={countdown}
          lastClear={lastClear}
          nextLabel={
            stageIndex < puzzles.length - 1
              ? `${DIFFICULTY_LABEL[puzzles[stageIndex + 1].difficulty]} ${stageIndex + 2}/5`
              : null
          }
          reducedMotion={reducedMotion}
          practice={mode === "practice"}
          onRetry={retryPracticeStage}
          onHow={() => openHow("play")}
          onAbort={() => setAbortOpen(true)}
          litRequired={light?.litRequired ?? 0}
          requiredCount={light?.requiredCount ?? 0}
          emissionOn={board.emissionEnabled[selectedRing]}
        />
      )}

      {screen === "runResult" && (
        <ResultScreen
          mode={mode ?? "practice"}
          records={stageRecords}
          puzzles={puzzles}
          totalTime={totals.time}
          totalMoves={totals.moves}
          submitState={submitState}
          submitError={submitError}
          ranking={ranking}
          shareNote={shareNote}
          onRetrySubmit={retryPending}
          onShare={async () => {
            const note = await shareOrCopy(
              shareText(GAME_TITLE, formatTime(totals.time), totals.moves),
            );
            setShareNote(note === "copied" ? "文面をコピーしました" : note === "failed" ? "共有できませんでした" : null);
          }}
          onHome={resetHome}
          onBoard={() => setScreen("leaderboard")}
        />
      )}

      {howOpen && (
        <div className="fixed inset-0 z-30 overflow-auto bg-stone/95">
          <HowToScreen onBack={() => setHowOpen(false)} />
        </div>
      )}
      {abortOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/70 p-4 sm:items-center">
          <div className="panel w-full max-w-sm p-5">
            <h2 className="font-display text-xl">挑戦を終了しますか</h2>
            <p className="mt-2 text-sm text-muted">
              いまの5問は破棄されます。競技の記録は残りません。
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="btn btn-ghost" onClick={() => setAbortOpen(false)}>
                続ける
              </button>
              <button className="btn btn-danger" onClick={resetHome}>
                終了する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HomeScreen(props: {
  title: string;
  playerTag: string;
  onTag: (v: string) => void;
  nameError: string | null;
  busy: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onChallenge: () => void;
  onPractice: () => void;
  onHow: () => void;
  onBoard: () => void;
  ranking: LeaderboardRow[];
  pending: PendingSubmit | null;
  onRetryPending: () => void;
  onShare: () => void;
  shareNote: string | null;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-start justify-between gap-3">
        <p className="text-xs tracking-[0.22em] text-muted">STONE RING PUZZLE</p>
        <button
          className="btn btn-ghost min-h-11 px-3"
          onClick={props.onToggleSound}
          aria-label={props.soundOn ? "音を切る" : "音を出す"}
        >
          <IconVolume muted={!props.soundOn} />
        </button>
      </header>
      <h1 className="mt-6 font-display text-4xl leading-tight tracking-tight sm:text-5xl">
        {props.title}
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
        5つの石板を解き、合計時間を競います。初級2問・中級2問・上級1問を出題します。
      </p>
      <p className="mt-3 rounded-md border border-edge-soft bg-ink px-3 py-2 text-xs leading-relaxed text-muted">
        これは試作プレビューです。記録は端末内のみで、公式の6件PR実装ではありません。
      </p>

      <label className="mt-8 text-xs tracking-wide text-muted">名前</label>
      <input
        className="field mt-2"
        value={props.playerTag}
        maxLength={PLAYER_TAG_MAX}
        placeholder="名前を入力してください"
        autoComplete="nickname"
        onChange={(e) => props.onTag(e.target.value)}
      />
      {props.nameError && (
        <p className="mt-2 text-sm text-danger">{props.nameError}</p>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <button className="btn btn-primary w-full" disabled={props.busy} onClick={props.onChallenge}>
          5問チャレンジ
        </button>
        <button className="btn btn-ghost w-full" disabled={props.busy} onClick={props.onPractice}>
          練習
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn btn-ghost" onClick={props.onHow}>
          遊び方
        </button>
        <button className="btn btn-ghost" onClick={props.onBoard}>
          順位
        </button>
      </div>
      <button className="btn btn-ghost mt-2 w-full" onClick={props.onShare}>
        シェア
      </button>
      {props.shareNote && <p className="mt-2 text-center text-xs text-muted">{props.shareNote}</p>}

      {props.pending && (
        <button className="btn btn-ember mt-4 w-full" onClick={props.onRetryPending}>
          未送信の記録を再送
        </button>
      )}

      <section className="panel mt-8 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg">上位</h2>
          <span className="text-xs text-muted">合計時間順</span>
        </div>
        {props.ranking.length === 0 ? (
          <p className="mt-3 text-sm text-muted">まだ記録がありません。</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {props.ranking.slice(0, 5).map((row, i) => (
              <li key={`${row.playerTag}-${row.submittedAt}`} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted stat w-6">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{row.playerTag}</span>
                <span className="stat text-parchment">{formatTime(row.totalTimeMs)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <a
        href={LAB_URL}
        className="mt-6 text-center text-xs text-muted underline decoration-edge underline-offset-4"
        target="_blank"
        rel="noreferrer"
      >
        カメレオンJPの実験場
      </a>
    </main>
  );
}

function HowToScreen({ onBack }: { onBack: () => void }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <button className="btn btn-ghost" onClick={onBack}>
        戻る
      </button>
      <h1 className="mt-6 font-display text-3xl">遊び方</h1>
      <ul className="mt-5 space-y-3 text-sm leading-relaxed text-parchment">
        <li>円を12方向に分けた3本の環を回します。</li>
        <li>太陽形の発光紋は、中心を通って反対側へ光を出します。</li>
        <li>X形の遮断石と、発射元ではない発光紋は光を止めます。止めた発光紋も石として遮ります。</li>
        <li>外周の緑の受光紋がすべて点灯すれば成功です。余分な方向へ光が出ても構いません。</li>
        <li>環をタップして選び、左右で1区画回転、中央で発光の切替。回転と切替が1手です。</li>
        <li>競技ではやり直しはありません。練習では現在の問題を最初からやり直せます。</li>
      </ul>
      <p className="mt-6 text-xs text-muted">
        キーボード：1/2/3または上下で環を選択、左右で回転、Spaceで発光切替。
      </p>
    </main>
  );
}

function LeaderboardScreen(props: {
  ranking: LeaderboardRow[];
  localBests: LocalBest[];
  onBack: () => void;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <button className="btn btn-ghost" onClick={props.onBack}>
        戻る
      </button>
      <h1 className="mt-6 font-display text-3xl">順位</h1>
      <ol className="panel mt-5 divide-y divide-edge-soft p-2">
        {props.ranking.length === 0 && (
          <li className="p-3 text-sm text-muted">まだ記録がありません。</li>
        )}
        {props.ranking.map((row, i) => (
          <li key={`${row.playerTag}-${row.submittedAt}`} className="flex items-baseline gap-3 p-3">
            <span className="stat w-6 text-muted">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{row.playerTag}</span>
            <span className="stat">{formatTime(row.totalTimeMs)}</span>
            <span className="stat w-12 text-right text-xs text-muted">{row.totalMoves}手</span>
          </li>
        ))}
      </ol>
      {props.localBests.length > 0 && (
        <>
          <h2 className="mt-8 font-display text-xl">この端末</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {props.localBests.slice(0, 5).map((row, i) => (
              <li key={row.submittedAt} className="flex justify-between">
                <span className="text-muted">{i + 1}. {row.playerTag}</span>
                <span className="stat">{formatTime(row.totalTimeMs)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}

function PlayScreen(props: {
  screen: Screen;
  puzzle: Puzzle;
  stageIndex: number;
  stageCount: number;
  board: BoardState;
  displayRot: [number, number, number];
  selectedRing: number;
  onSelectRing: (ring: number) => void;
  onRotate: (dir: "l" | "r") => void;
  onToggle: () => void;
  moves: number;
  playMs: number;
  countdown: number;
  lastClear: { timeMs: number; moves: number } | null;
  nextLabel: string | null;
  reducedMotion: boolean;
  practice: boolean;
  onRetry: () => void;
  onHow: () => void;
  onAbort: () => void;
  litRequired: number;
  requiredCount: number;
  emissionOn: boolean;
}) {
  const playing = props.screen === "playing";
  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="grid grid-cols-3 items-end gap-2 text-sm">
        <div>
          <p className="text-[11px] tracking-wide text-muted">
            {DIFFICULTY_LABEL[props.puzzle.difficulty]}
          </p>
          <p className="stat text-base">
            {props.stageIndex + 1}/{props.stageCount}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[11px] tracking-wide text-muted">タイム</p>
          <p className="stat font-display text-2xl leading-none">
            {formatTime(props.screen === "stageSolved" && props.lastClear ? props.lastClear.timeMs : props.playMs)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] tracking-wide text-muted">点灯</p>
          <p className="stat text-base">
            {props.litRequired}/{props.requiredCount}
          </p>
        </div>
      </header>

      <div className="relative mx-auto mt-1 w-full max-w-[420px] touch-none">
        <StoneBoard
          puzzle={props.puzzle}
          state={props.board}
          displayRotations={props.displayRot}
          selectedRing={props.selectedRing}
          onSelectRing={props.onSelectRing}
          reducedMotion={props.reducedMotion}
        />
        {props.screen === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone/40">
            <p className="font-display text-7xl stat">{props.countdown}</p>
          </div>
        )}
        {props.screen === "stageSolved" && props.lastClear && (
          <div className="absolute inset-0 flex items-center justify-center bg-stone/55 px-6 text-center">
            <div>
              <p className="font-display text-2xl">石板を解きました</p>
              <p className="stat mt-2 text-lg">
                {formatTime(props.lastClear.timeMs)} / {props.lastClear.moves}手
              </p>
              {props.nextLabel && (
                <p className="mt-2 text-sm text-muted">次 {props.nextLabel}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="mt-1 text-center text-xs tracking-wide text-muted">
        選択 {RING_LABELS[props.selectedRing]}　手数 {props.moves}
      </p>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          className="btn btn-ghost min-h-14 text-lg"
          disabled={!playing}
          onPointerDown={(e) => {
            e.preventDefault();
            props.onRotate("l");
          }}
        >
          左へ
        </button>
        <button
          className="btn btn-ember min-h-14"
          disabled={!playing}
          onPointerDown={(e) => {
            e.preventDefault();
            props.onToggle();
          }}
        >
          {props.emissionOn ? "光を止める" : "光を出す"}
        </button>
        <button
          className="btn btn-ghost min-h-14 text-lg"
          disabled={!playing}
          onPointerDown={(e) => {
            e.preventDefault();
            props.onRotate("r");
          }}
        >
          右へ
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        {props.practice && (
          <button className="btn btn-ghost flex-1" disabled={!playing} onClick={props.onRetry}>
            <IconRetry />
            やり直す
          </button>
        )}
        <button className="btn btn-ghost flex-1" onClick={props.onHow}>
          遊び方
        </button>
        <button className="btn btn-danger flex-1" onClick={props.onAbort}>
          中断
        </button>
      </div>
      <p className="sr-only">
        アニメーションは{ROTATE_ANIM_MS}ミリ秒です。判定は入力と同時に確定します。
      </p>
    </main>
  );
}

function ResultScreen(props: {
  mode: RunMode;
  records: StageRecord[];
  puzzles: Puzzle[];
  totalTime: number;
  totalMoves: number;
  submitState: "idle" | "pending" | "ok" | "fail" | "skip";
  submitError: string | null;
  ranking: LeaderboardRow[];
  shareNote: string | null;
  onRetrySubmit: () => void;
  onShare: () => void;
  onHome: () => void;
  onBoard: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <p className="text-xs tracking-[0.2em] text-muted">
        {props.mode === "challenge" ? "CHALLENGE" : "PRACTICE"}
      </p>
      <h1 className="mt-2 font-display text-3xl">5問の結果</h1>
      <p className="stat mt-3 font-display text-4xl">{formatTime(props.totalTime)}</p>
      <p className="mt-1 text-sm text-muted">総手数 {props.totalMoves}</p>

      <ul className="panel mt-6 divide-y divide-edge-soft">
        {props.records.map((row, i) => (
          <li key={row.puzzleId} className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm">
            <span>
              {i + 1}. {DIFFICULTY_LABEL[props.puzzles[i]?.difficulty ?? "easy"]}
            </span>
            <span className="stat">
              {formatTime(row.timeMs)} / {row.moveCount}手
            </span>
          </li>
        ))}
      </ul>

      {props.mode === "challenge" && (
        <p className="mt-4 text-sm text-muted">
          {props.submitState === "pending" && "記録を検証して送信しています…"}
          {props.submitState === "ok" && "記録を受け付けました。"}
          {props.submitState === "fail" && (props.submitError ?? "送信に失敗しました。")}
          {props.submitState === "skip" && "練習のため順位には載りません。"}
        </p>
      )}
      {props.submitState === "fail" && (
        <button className="btn btn-ember mt-3 w-full" onClick={props.onRetrySubmit}>
          再送する
        </button>
      )}

      <div className="mt-5 flex flex-col gap-2">
        <button className="btn btn-primary w-full" onClick={props.onShare}>
          結果をシェア
        </button>
        {props.shareNote && <p className="text-center text-xs text-muted">{props.shareNote}</p>}
        <button className="btn btn-ghost w-full" onClick={props.onBoard}>
          順位を見る
        </button>
        <button className="btn btn-ghost w-full" onClick={props.onHome}>
          ホームへ
        </button>
      </div>
    </main>
  );
}
